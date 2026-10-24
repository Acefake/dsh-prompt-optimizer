/**
 * Host half of the Prompt Optimizer bundle.
 *
 * The Host owns the two things a browser cannot do: enumerate the configured
 * model routes and make an authenticated model call. It exposes them to the
 * Client half over two same-origin JSON routes on the Harness web server, so
 * the browser module never needs provider credentials.
 *
 * Routes (loopback-only, same-origin):
 * - `GET  /plugins/prompt-optimizer/health`   capability probe
 * - `GET  /plugins/prompt-optimizer/models`   configured provider/model catalog
 * - `POST /plugins/prompt-optimizer/optimize` rewrite one composer draft
 *
 * The rewrite is deliberately grounded: the model receives only the draft,
 * a small read-only project brief, and recent conversation text, and its
 * system instruction forbids inventing requirements or facts.
 *
 * @module @local/prompt-optimizer
 */

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/** Exact route paths this plugin owns. */
const ROUTES = {
  health: '/plugins/prompt-optimizer/health',
  models: '/plugins/prompt-optimizer/models',
  optimize: '/plugins/prompt-optimizer/optimize',
  optimizeStream: '/plugins/prompt-optimizer/optimize-stream',
}

/** Hard bounds that keep one rewrite request small and predictable. */
const MAX_REQUEST_BYTES = 256 * 1024
const MAX_DRAFT_CHARS = 20000
const MAX_CONTEXT_CHARS = 9000
const MAX_OUTPUT_TOKENS = 1600
const REQUEST_TIMEOUT_MS = 120000
const MAX_PROJECT_ENTRIES = 80
const MAX_CONVERSATION_MESSAGES = 10
const MAX_MESSAGE_CHARS = 800

/**
 * The rewrite instruction. Its hard rules are what keep the result honest:
 * only the supplied draft and context may inform the rewrite, ambiguity stays
 * an explicit question instead of becoming an invented requirement.
 */
const SYSTEM_PROMPT = [
  'You rewrite a draft prompt written by a person to an AI coding agent, so the agent can act on it more reliably.',
  'You receive: (1) a short project context, (2) recent conversation context, (3) the draft prompt.',
  '',
  'Hard rules:',
  '- Use ONLY the draft and the supplied context. Never invent requirements, files, APIs, versions, constraints, acceptance criteria, or facts that are not present or directly implied.',
  '- If information needed for a precise prompt is missing, keep it as an explicit open question or placeholder. Do not guess and do not silently choose a solution.',
  '- Preserve the intent, scope, and constraints of the draft.',
  '- Write the result in the same language as the draft.',
  '- Do not answer, implement, or execute the task. Do not talk about yourself or about rewriting.',
  '- Remove filler and repetition, keep concrete details, and order the prompt logically: goal and context, then what to do, then constraints, then the expected result.',
  '- Stay compact: aim for at most about twice the draft length unless the draft is extremely short; do not pad with generic advice.',
  '- List at most three open questions, and only ones whose answer would change what gets implemented.',
  '- Output ONLY the rewritten prompt text: no preamble, no explanation, no quotes, no markdown code fence.',
].join('\n')

/** The route carrier must exist before this plugin registers anything. */
export const inject = ['webServer']

/**
 * Register the Host capability. The routes are registered as effects so a
 * profile reload or plugin disable removes them; service lookups stay lazy so
 * the handler still works if a provider is mounted after this plugin.
 * @param {import('@deepseek-ai/cordis').Context} ctx plugin context
 */
export function apply(ctx) {
  const server = ctx.webServer ?? ctx.get('webServer')
  if (!server) return

  ctx.effect(() => server.register({ kind: 'exact', path: ROUTES.health, handler: healthHandler }))

  ctx.effect(() => server.register({
    kind: 'exact',
    path: ROUTES.models,
    handler: (req, res) => guard(req, res, 'GET', async () => {
      const catalog = await describeModels(ctx)
      sendJson(res, 200, { ok: true, ...catalog })
    }),
  }))

  ctx.effect(() => server.register({
    kind: 'exact',
    path: ROUTES.optimize,
    handler: (req, res) => guard(req, res, 'POST', async () => {
      const body = await readJsonBody(req)
      const result = await optimizeDraft(ctx, body)
      sendJson(res, 200, { ok: true, ...result })
    }),
  }))

  ctx.effect(() => server.register({
    kind: 'exact',
    path: ROUTES.optimizeStream,
    handler: (req, res) => streamOptimize(ctx, req, res),
  }))
}

/** Answer a capability probe so the Client can explain an unavailable Host. */
function healthHandler(req, res) {
  guard(req, res, 'GET', async () => {
    sendJson(res, 200, { ok: true, version: '1.0.0' })
  })
}

/**
 * Wrap one route handler with the policy every route shares: loopback peers
 * only, same-origin writes only, one exact method, and a JSON error envelope.
 * @param {import('node:http').IncomingMessage} req request
 * @param {import('node:http').ServerResponse} res response
 * @param {'GET' | 'POST'} method accepted method
 * @param {() => Promise<void>} run route body
 */
function guard(req, res, method, run) {
  void (async () => {
    try {
      if (!isLoopback(req.socket?.remoteAddress)) {
        sendJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'This capability is limited to the local machine.' } })
        return
      }
      if (method === 'POST' && !isSameOrigin(req)) {
        sendJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'Cross-origin writes are not allowed.' } })
        return
      }
      if ((req.method ?? 'GET').toUpperCase() !== method) {
        res.setHeader('allow', method)
        sendJson(res, 405, { ok: false, error: { code: 'method-not-allowed', message: `Use ${method}.` } })
        return
      }
      await run()
    } catch (error) {
      const failure = toFailure(error)
      sendJson(res, failure.status, { ok: false, error: { code: failure.code, message: failure.message } })
    }
  })()
}

/**
 * Read and parse one bounded JSON request body.
 * @param {import('node:http').IncomingMessage} req request
 * @returns {Promise<Record<string, unknown>>} parsed object body
 */
async function readJsonBody(req) {
  const chunks = []
  let bytes = 0
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > MAX_REQUEST_BYTES) throw badRequest('The request body is too large.')
    chunks.push(chunk)
  }
  if (bytes === 0) return {}
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object')
    return value
  } catch {
    throw badRequest('The request body is not a JSON object.')
  }
}

/**
 * Describe every currently routable provider/model route plus the deployment
 * default, preferring the Session controller's own catalog projection so the
 * selector matches the shipped model picker.
 * @param {import('@deepseek-ai/cordis').Context} ctx plugin context
 * @returns {Promise<{default: unknown, groups: unknown[], failures: unknown[]}>} catalog
 */
async function describeModels(ctx) {
  const controller = ctx.get('sessionController')
  if (controller && typeof controller.modelCatalog === 'function') {
    const catalog = await controller.modelCatalog()
    return {
      default: catalog.default ?? null,
      groups: Array.isArray(catalog.groups) ? catalog.groups : [],
      failures: Array.isArray(catalog.failures) ? catalog.failures : [],
    }
  }
  const llm = ctx.get('llm')
  if (!llm) throw failure(503, 'no-model-service', 'No model service is mounted in this Harness.')
  const failures = []
  const groups = []
  for (const provider of llm.listProviders()) {
    try {
      const models = await llm.listModels(provider.id)
      groups.push({
        id: provider.id,
        name: provider.name ?? provider.id,
        models: models.map((model) => ({ id: model.id, name: model.name ?? model.id, description: model.description })),
      })
    } catch (error) {
      failures.push({ id: provider.id, name: provider.name ?? provider.id, message: messageOf(error) })
    }
  }
  const selection = ctx.get('agentDefaultModel')?.currentSelection?.() ?? null
  return { default: selection, groups, failures }
}

/**
 * Validate one request and assemble everything the model call needs.
 * @param {import('@deepseek-ai/cordis').Context} ctx plugin context
 * @param {Record<string, unknown>} body request body
 * @returns {Promise<{llm: {prepareCall: Function}, provider: string, model: string, input: string, sessionId?: string}>} prepared request
 */
async function prepareOptimize(ctx, body) {
  const draft = typeof body.draft === 'string' ? body.draft.trim() : ''
  if (!draft) throw badRequest('The draft is empty. Type something in the composer first.')
  if (draft.length > MAX_DRAFT_CHARS) throw badRequest(`The draft is longer than ${MAX_DRAFT_CHARS} characters.`)
  const provider = typeof body.provider === 'string' ? body.provider.trim() : ''
  const model = typeof body.model === 'string' ? body.model.trim() : ''
  if (!provider || !model) throw badRequest('Choose a provider and a model first.')
  const sessionId = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : undefined

  const llm = ctx.get('llm')
  if (!llm) throw failure(503, 'no-model-service', 'No model service is mounted in this Harness.')

  const context = await buildContext(ctx, sessionId)
  return { llm, provider, model, sessionId, input: composeUserInput(context, draft) }
}

/**
 * Rewrite one draft and answer with one JSON envelope.
 * @param {import('@deepseek-ai/cordis').Context} ctx plugin context
 * @param {Record<string, unknown>} body request body
 * @returns {Promise<{text: string, route: {provider: string, model: string}}>} rewritten prompt
 */
async function optimizeDraft(ctx, body) {
  const request = await prepareOptimize(ctx, body)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const text = await runModel(request.llm, { ...request, signal: controller.signal })
    return { text, route: { provider: request.provider, model: request.model } }
  } catch (error) {
    if (controller.signal.aborted) throw failure(504, 'timeout', 'The model did not answer in time. Try again or choose a faster model.')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Rewrite one draft as a server-sent-event stream so the dialog can show the
 * answer while it is generated. Validation failures answer as JSON before the
 * event stream starts; everything after that is a `data:` frame.
 * @param {import('@deepseek-ai/cordis').Context} ctx plugin context
 * @param {import('node:http').IncomingMessage} req request
 * @param {import('node:http').ServerResponse} res response
 */
function streamOptimize(ctx, req, res) {
  void (async () => {
    let started = false
    try {
      if (!isLoopback(req.socket?.remoteAddress)) {
        sendJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'This capability is limited to the local machine.' } })
        return
      }
      if (!isSameOrigin(req)) {
        sendJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'Cross-origin writes are not allowed.' } })
        return
      }
      if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
        res.setHeader('allow', 'POST')
        sendJson(res, 405, { ok: false, error: { code: 'method-not-allowed', message: 'Use POST.' } })
        return
      }
      const body = await readJsonBody(req)
      const request = await prepareOptimize(ctx, body)

      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      })
      started = true

      let closed = false
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      const writeEvent = (event) => {
        if (closed || res.writableEnded) return
        try {
          res.write(`data: ${JSON.stringify(event)}\n\n`)
        } catch {
          closed = true
        }
      }
      res.on('close', () => {
        closed = true
        if (!res.writableEnded) controller.abort()
      })

      try {
        const text = await runModel(request.llm, {
          ...request,
          signal: controller.signal,
          onDelta: (delta) => writeEvent({ type: 'delta', text: delta }),
        })
        writeEvent({ type: 'done', text, route: { provider: request.provider, model: request.model } })
      } catch (error) {
        const problem = controller.signal.aborted
          ? { status: 504, code: 'timeout', message: 'The model did not answer in time. Try again or choose a faster model.' }
          : toFailure(error)
        writeEvent({ type: 'error', code: problem.code, message: problem.message })
      } finally {
        clearTimeout(timer)
        if (!closed && !res.writableEnded) res.end()
      }
    } catch (error) {
      if (started) {
        try {
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ type: 'error', code: 'internal', message: messageOf(error) })}\n\n`)
            res.end()
          }
        } catch {
          /* The peer already closed the stream. */
        }
        return
      }
      const failure = toFailure(error)
      sendJson(res, failure.status, { ok: false, error: { code: failure.code, message: failure.message } })
    }
  })()
}

/**
 * Make one model call, reporting text deltas while they arrive and returning
 * the cleaned final text.
 * @param {{prepareCall: Function}} llm the Host LLM service
 * @param {{provider: string, model: string, input: string, sessionId?: string, signal: AbortSignal, onDelta?: (delta: string) => void}} call call description
 * @returns {Promise<string>} the finished response text
 */
async function runModel(llm, { provider, model, input, sessionId, signal, onDelta }) {
  let prepared
  try {
    prepared = await llm.prepareCall({ provider, model, maxTokens: MAX_OUTPUT_TOKENS }, signal, (controls, modelInfo) => {
      const effort = modelInfo?.reasoning?.efforts?.[0]?.id
      return effort === undefined ? controls : { ...controls, reasoningEffort: effort }
    })
  } catch (error) {
    throw failure(400, 'model-unavailable', messageOf(error))
  }
  const options = {
    ...prepared.config,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: [{ type: 'text', text: input }] }],
    sessionId: typeof sessionId === 'string' && sessionId ? sessionId : `prompt-optimizer-${randomUUID()}`,
    signal,
  }
  const blocks = []
  let deltas = ''
  let finish
  try {
    for await (const chunk of prepared.stream(options)) {
      if (!chunk || typeof chunk !== 'object') continue
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
        deltas += chunk.text
        if (onDelta) onDelta(chunk.text)
      } else if (chunk.type === 'block-end' && chunk.block?.type === 'text' && typeof chunk.block.text === 'string') {
        blocks.push(chunk.block.text)
      } else if (chunk.type === 'finish') finish = chunk.reason
    }
  } catch (error) {
    if (signal.aborted) throw error
    throw failure(502, 'model-request-failed', messageOf(error))
  }
  if (finish && (finish.kind === 'error' || finish.kind === 'aborted')) {
    throw failure(502, 'model-request-failed', finish.failure?.message ?? 'The model request failed.')
  }
  const text = cleanOutput(blocks.length > 0 ? blocks.join('\n\n') : deltas)
  if (!text) throw failure(502, 'empty-response', 'The model returned an empty response. Try again.')
  return text
}

/**
 * Build the small, read-only context that grounds one rewrite: the Session
 * working directory, a shallow project brief, and the latest conversation text.
 * @param {import('@deepseek-ai/cordis').Context} ctx plugin context
 * @param {string | undefined} sessionId current Session identity
 * @returns {Promise<{cwd?: string, project?: string, conversation?: string}>} grounded context
 */
async function buildContext(ctx, sessionId) {
  const inspected = await inspectSession(ctx, sessionId)
  const cwd = inspected?.meta?.cwd
  const conversation = inspected ? recentConversation(inspected.events) : ''
  return {
    cwd: typeof cwd === 'string' ? cwd : undefined,
    project: typeof cwd === 'string' ? projectBrief(cwd) : '',
    conversation,
  }
}

/**
 * Inspect one Session without activating its Agent; every failure degrades to
 * an empty context rather than blocking the rewrite.
 * @param {import('@deepseek-ai/cordis').Context} ctx plugin context
 * @param {string | undefined} sessionId Session identity
 * @returns {Promise<{meta?: {cwd?: string}, events?: unknown[]} | undefined>} inspection
 */
async function inspectSession(ctx, sessionId) {
  if (!sessionId) return undefined
  const controller = ctx.get('sessionController')
  if (!controller || typeof controller.inspect !== 'function') return undefined
  try {
    return await controller.inspect(sessionId)
  } catch {
    return undefined
  }
}

/**
 * Render the latest human/assistant text of one Session as bounded plain text.
 * @param {unknown[] | undefined} events stored Session events
 * @returns {string} conversation excerpt
 */
function recentConversation(events) {
  if (!Array.isArray(events) || events.length === 0) return ''
  const lines = []
  let budget = MAX_CONTEXT_CHARS
  for (let index = events.length - 1; index >= 0 && lines.length < MAX_CONVERSATION_MESSAGES && budget > 0; index -= 1) {
    const entry = events[index]
    if (!entry || typeof entry !== 'object') continue
    const type = entry.type
    if (type !== 'user/message' && type !== 'assistant/message') continue
    const message = type === 'user/message' ? entry.data : entry.data?.message
    const text = messageText(message?.content).trim()
    if (!text) continue
    const clipped = clip(text, Math.min(MAX_MESSAGE_CHARS, budget))
    if (!clipped) continue
    budget -= clipped.length
    lines.unshift(`${type === 'user/message' ? 'User' : 'Assistant'}: ${clipped}`)
  }
  return lines.join('\n')
}

/**
 * Summarize a project directory without reading source files: top-level
 * entries, a package.json summary when present, and the current Git branch.
 * @param {string} cwd absolute working directory
 * @returns {string} project brief
 */
function projectBrief(cwd) {
  const parts = []
  let entries = []
  try {
    entries = fs.readdirSync(cwd, { withFileTypes: true })
  } catch {
    return ''
  }
  const listing = entries
    .filter((entry) => !entry.name.startsWith('.') || entry.name === '.git')
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, MAX_PROJECT_ENTRIES)
    .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
  if (listing.length > 0) parts.push(`Top-level entries: ${listing.join(', ')}`)

  const branch = gitBranch(cwd)
  if (branch) parts.push(`Git branch: ${branch}`)

  const manifest = packageSummary(cwd)
  if (manifest) parts.push(`package.json: ${manifest}`)
  return parts.join('\n')
}

/**
 * Read the current branch name straight from `.git/HEAD` (no subprocess).
 * @param {string} cwd project directory
 * @returns {string | undefined} branch or detached commit
 */
function gitBranch(cwd) {
  try {
    const head = fs.readFileSync(path.join(cwd, '.git', 'HEAD'), 'utf8').trim()
    const match = /^ref:\s*refs\/heads\/(.+)$/.exec(head)
    return match ? match[1] : `detached at ${head.slice(0, 12)}`
  } catch {
    return undefined
  }
}

/**
 * Summarize a package manifest's identity and script names.
 * @param {string} cwd project directory
 * @returns {string | undefined} summary
 */
function packageSummary(cwd) {
  try {
    const raw = fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')
    if (raw.length > 200000) return undefined
    const manifest = JSON.parse(raw)
    const bits = []
    if (typeof manifest.name === 'string') bits.push(manifest.name)
    if (typeof manifest.description === 'string' && manifest.description) bits.push(clip(manifest.description, 200))
    if (manifest.scripts && typeof manifest.scripts === 'object') {
      const scripts = Object.keys(manifest.scripts).slice(0, 20)
      if (scripts.length > 0) bits.push(`scripts: ${scripts.join(', ')}`)
    }
    return bits.length > 0 ? bits.join(' | ') : undefined
  } catch {
    return undefined
  }
}

/**
 * Assemble the exact user message the rewriting model receives.
 * @param {{cwd?: string, project?: string, conversation?: string}} context grounded context
 * @param {string} draft the composer draft
 * @returns {string} user message text
 */
function composeUserInput(context, draft) {
  const sections = []
  if (context.cwd) sections.push(`## Project context\nWorking directory: ${context.cwd}${context.project ? `\n${context.project}` : ''}`)
  else if (context.project) sections.push(`## Project context\n${context.project}`)
  if (context.conversation) sections.push(`## Recent conversation\n${context.conversation}`)
  sections.push(`## Draft prompt to rewrite\n${draft}`)
  return sections.join('\n\n')
}

/**
 * Join text content blocks of one stored message.
 * @param {unknown} content message content
 * @returns {string} plain text
 */
function messageText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

/**
 * Trim a model answer and drop an accidental code fence wrapper.
 * @param {string} text raw model text
 * @returns {string} the prompt text
 */
function cleanOutput(text) {
  let value = text.trim()
  const fence = /^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n?```$/u.exec(value)
  if (fence) value = fence[1].trim()
  return value
}

/**
 * Clip one string to a character budget.
 * @param {string} value source text
 * @param {number} limit maximum characters
 * @returns {string} clipped text
 */
function clip(value, limit) {
  if (value.length <= limit) return value
  return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}

/**
 * Treat loopback peers only: IPv4, IPv6, and mapped IPv4 forms.
 * @param {string | undefined} address peer address
 * @returns {boolean} whether the peer is this machine
 */
function isLoopback(address) {
  if (!address) return false
  const normalized = address.startsWith('::ffff:') ? address.slice(7) : address
  return normalized === '::1' || normalized === '127.0.0.1' || normalized.startsWith('127.')
}

/**
 * Accept a write only from the page the same server delivered.
 * @param {import('node:http').IncomingMessage} req request
 * @returns {boolean} whether the request is same-origin
 */
function isSameOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

/**
 * Write one JSON response.
 * @param {import('node:http').ServerResponse} res response
 * @param {number} status HTTP status
 * @param {unknown} value JSON body
 */
function sendJson(res, status, value) {
  if (res.writableEnded) return
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** @typedef {{status: number, code: string, message: string}} Failure */

/**
 * Build one classified failure.
 * @param {number} status HTTP status
 * @param {string} code stable machine code
 * @param {string} message user-facing message
 * @returns {Failure} failure
 */
function failure(status, code, message) {
  return { status, code, message }
}

/**
 * Build a 400-class failure.
 * @param {string} message user-facing message
 * @returns {Failure} failure
 */
function badRequest(message) {
  return failure(400, 'bad-request', message)
}

/**
 * Normalize any thrown value into the JSON error shape.
 * @param {unknown} error thrown value
 * @returns {Failure} failure
 */
function toFailure(error) {
  if (error && typeof error === 'object' && typeof error.status === 'number' && typeof error.code === 'string') {
    return { status: error.status, code: error.code, message: String(error.message ?? 'Request failed.') }
  }
  return { status: 500, code: 'internal', message: messageOf(error) }
}

/**
 * Read a message out of any thrown value.
 * @param {unknown} error thrown value
 * @returns {string} message text
 */
function messageOf(error) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return 'Unexpected failure.'
}
