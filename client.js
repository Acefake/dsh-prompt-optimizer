/**
 * Client half of the Prompt Optimizer bundle.
 *
 * Adds one compact control to the left end of the composer tool row, right
 * before the model selector, plus a review dialog in the frame-wide overlay.
 * The dialog never writes into the composer on its own: the person previews
 * (and may edit) the rewritten prompt, then chooses replace or insert.
 *
 * The Host half owns the model call. This module talks to it over the
 * same-origin JSON routes it registers on the Harness web server.
 *
 * @module @local/prompt-optimizer/client
 */

window.__ModuleLoader__.load({
  id: '@local/prompt-optimizer',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'prompt-optimizer'
    const STYLE_ID = '@local/prompt-optimizer/plugin.css'
    const ROUTE_STORAGE_KEY = 'dsh.prompt-optimizer.route'
    const API = {
      models: '/plugins/prompt-optimizer/models',
      optimizeStream: '/plugins/prompt-optimizer/optimize-stream',
    }
    /** Default chord advertised in the UI; Desktop/Web both bind Primary+Shift+U. */
    const SHORTCUT_KEYS = /mac/iu.test(String((typeof navigator !== 'undefined' && navigator.platform) || '')) ? '⌘⇧U' : 'Ctrl+Shift+U'
    /** Primary submit chord inside the dialog. */
    const SUBMIT_KEYS = /mac/iu.test(String((typeof navigator !== 'undefined' && navigator.platform) || '')) ? '⌘↵' : 'Ctrl+Enter'

    /** @type {Record<string, Record<string, string>>} */
    const LOCALE = {
      en: {
        trigger: 'Optimize prompt',
        triggerWithKeys: 'Optimize prompt · {keys}',
        shortcutOpen: 'Open prompt optimizer',
        shortcutHint: 'Shortcut: {keys}',
        title: 'Optimize prompt',
        subtitle: 'Rewrites the composer draft with the model you pick below, grounded in this project and the recent conversation. It only uses what is already here and does not invent requirements.',
        model: 'Model',
        loadingModels: 'Reading configured models…',
        noModels: 'No model route is configured. Add a model provider in Settings first.',
        modelsFailed: 'Could not read models: {message}',
        refresh: 'Reload models',
        optimize: 'Optimize',
        optimizing: 'Optimizing…',
        again: 'Optimize again',
        resultLabel: 'Optimized prompt (editable)',
        original: 'View original draft',
        replace: 'Replace draft',
        insert: 'Insert at cursor',
        cancel: 'Cancel',
        close: 'Close',
        emptyDraft: 'The composer is empty. Write something first, then optimize it.',
        chipWarning: 'The draft contains {count} reference chip(s); replacing turns them into plain text.',
        insertRejected: 'Could not insert: the composer moved or is submitting. Use “Replace draft” instead.',
        applyUnavailable: 'The composer is not available right now, so the result cannot be written back.',
        noSelection: 'Choose a model first.',
        emptyResult: 'The model returned no text. Try again.',
        error: 'Optimization failed: {message}',
        chars: '{count} characters',
        providerFailure: '{name}: {message}',
        doneHint: 'Generated. Review it, then write it back to the composer.',
        streamingHint: 'Generating… Cancel stops the request.',
        followSession: 'Default follows this session’s selected model.',
        tabResult: 'Rewrite',
        tabOriginal: 'Original',
        tabCompare: 'Compare',
        paneOriginal: 'Original draft',
        paneResult: 'Rewritten',
        noResultYet: 'The rewritten prompt appears here.',
        requestFailed: 'Request failed with status {status}.',
        staleHint: 'This result was generated from the draft captured when the dialog opened.',
      },
      zh: {
        trigger: '优化提示词',
        triggerWithKeys: '优化提示词 · {keys}',
        shortcutOpen: '打开提示词优化',
        shortcutHint: '快捷键：{keys}',
        title: '优化提示词',
        subtitle: '用下面选择的模型改写输入框里的草稿，并只依据当前项目和最近对话提供的信息；不会虚构需求。',
        model: '模型',
        loadingModels: '正在读取已配置的模型…',
        noModels: '还没有配置模型。请先在设置里添加模型服务。',
        modelsFailed: '读取模型失败：{message}',
        refresh: '重新读取模型',
        optimize: '开始优化',
        optimizing: '正在优化…',
        again: '重新优化',
        resultLabel: '优化结果（可编辑）',
        original: '查看原草稿',
        replace: '替换草稿',
        insert: '插入到光标处',
        cancel: '取消',
        close: '关闭',
        emptyDraft: '输入框还是空的，先写点内容再优化。',
        chipWarning: '草稿里有 {count} 个引用芯片，替换后它们会变成纯文本。',
        insertRejected: '无法插入：输入框正在提交或光标位置已变化。可以改用“替换草稿”。',
        applyUnavailable: '输入框当前不可用，结果无法写回。',
        noSelection: '请先选择模型。',
        emptyResult: '模型没有返回内容，请重试。',
        error: '优化失败：{message}',
        chars: '{count} 字',
        providerFailure: '{name}：{message}',
        doneHint: '已生成。确认内容后，再写回输入框。',
        streamingHint: '正在生成…点「取消」会中断请求。',
        followSession: '默认跟随当前会话所选模型。',
        tabResult: '改写结果',
        tabOriginal: '原草稿',
        tabCompare: '对比',
        paneOriginal: '原稿',
        paneResult: '改写稿',
        noResultYet: '改写结果会在这里实时出现。',
        requestFailed: '请求失败（状态码 {status}）。',
        staleHint: '这条结果基于打开面板时的草稿生成。',
      },
    }

    const CSS = [
      '.dsh-po-trigger{flex:none;width:28px;height:28px;padding:0;border:0;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary,#667085);display:inline-flex;align-items:center;justify-content:center;cursor:pointer}',
      '.dsh-po-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,#101828)}',
      '.dsh-po-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:1px}',
      '.dsh-po-trigger:disabled{opacity:.5;cursor:default}',
      '.dsh-po-overlay{position:fixed;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(15,17,22,.36);pointer-events:auto}',
      '.dsh-po-panel{width:min(640px,100%);max-height:min(82vh,780px);display:flex;flex-direction:column;background:var(--dsw-alias-bg-overlay,#fff);color:var(--dsw-alias-label-primary,#101828);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));border-radius:14px;box-shadow:0 24px 64px rgba(0,0,0,.32);overflow:hidden;font-size:13px;line-height:1.55}',
      '.dsh-po-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1))}',
      '.dsh-po-title{margin:0;font-size:14px;font-weight:600}',
      '.dsh-po-iconbtn{width:26px;height:26px;padding:0;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary,#667085);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px;line-height:1}',
      '.dsh-po-iconbtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,#101828)}',
      '.dsh-po-body{padding:14px 16px;display:flex;flex-direction:column;gap:12px;overflow:auto}',
      '.dsh-po-hint{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary,#667085)}',
      '.dsh-po-row{display:flex;align-items:center;gap:10px;min-width:0}',
      '.dsh-po-label{flex:none;min-width:34px;font-size:12px;color:var(--dsw-alias-label-secondary,#667085)}',
      '.dsh-po-select{flex:1;min-width:0;height:30px;padding:0 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;font:inherit;font-size:12px}',
      '.dsh-po-select:disabled{opacity:.6}',
      '.dsh-po-note{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary,#667085);overflow-wrap:anywhere}',
      '.dsh-po-note[data-kind=warn]{color:var(--dsw-alias-state-warn-primary,#b54708)}',
      '.dsh-po-note[data-kind=error]{color:var(--dsw-alias-state-error-primary,#d92d20)}',
      '.dsh-po-tabs{display:flex;align-items:center;gap:4px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));padding-bottom:8px;margin-bottom:2px}',
      '.dsh-po-tab{height:26px;padding:0 10px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary,#667085);font:inherit;font-size:12px;cursor:pointer}',
      '.dsh-po-tab:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
      '.dsh-po-tab[data-active=true]{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,#101828)}',
      '.dsh-po-pane{display:flex;flex-direction:column;gap:6px;min-width:0}',
      '.dsh-po-paneLabel{font-size:12px;color:var(--dsw-alias-label-secondary,#667085)}',
      '.dsh-po-compare{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
      '.dsh-po-compare .dsh-po-textarea,.dsh-po-compare .dsh-po-preFrame{min-height:220px;max-height:34vh}',
      '.dsh-po-preFrame{box-sizing:border-box;width:100%;min-height:150px;max-height:36vh;overflow:auto;padding:10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));background:var(--dsw-alias-bg-layer-1,#fff);white-space:pre-wrap;word-break:break-word;margin:0;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary,#667085)}',
      '.dsh-po-emptyHint{color:var(--dsw-alias-label-secondary,#667085);font-size:12px;padding:12px;border-radius:8px;border:1px dashed var(--dsw-alias-border-l1,rgba(0,0,0,.16))}',
      '@media (max-width: 720px){.dsh-po-compare{grid-template-columns:1fr}}',
      '.dsh-po-textarea{box-sizing:border-box;width:100%;min-height:150px;max-height:36vh;resize:vertical;padding:10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;font:inherit;line-height:1.6}',
      '.dsh-po-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1))}',
      '.dsh-po-footer .dsh-po-hint{margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-po-spacer{flex:1}',
      '.dsh-po-btn{height:30px;padding:0 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));background:transparent;color:var(--dsw-alias-label-primary,#101828);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}',
      '.dsh-po-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
      '.dsh-po-btn:disabled{opacity:.55;cursor:default}',
      '.dsh-po-btn[data-variant=primary]{border-color:transparent;background:var(--dsw-alias-brand-primary,#4d6bfe);color:#fff}',
      '.dsh-po-btn[data-variant=primary]:hover:not(:disabled){background:var(--dsw-alias-brand-primary,#4d6bfe);filter:brightness(1.07)}',
      '.dsh-po-status{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary,#667085)}',
      '.dsh-po-spin{display:inline-block;width:13px;height:13px;border:2px solid var(--dsw-alias-border-l2,rgba(0,0,0,.2));border-top-color:var(--dsw-alias-brand-primary,#4d6bfe);border-radius:50%;animation:dsh-po-spin .8s linear infinite}',
      '@keyframes dsh-po-spin{to{transform:rotate(360deg)}}',
      '@media (prefers-reduced-motion: reduce){.dsh-po-spin{animation-duration:2.4s}}',
    ].join('\n')

    /**
     * Interpolate `{name}` placeholders for the built-in fallback translator.
     * @param {string} template message template
     * @param {Record<string, unknown> | undefined} values values
     * @returns {string} message
     */
    function interpolate(template, values) {
      if (!values) return template
      return template.replace(/\{(\w+)\}/g, (match, name) => (name in values ? String(values[name]) : match))
    }

    /**
     * Translate without the locale service, used only if a slot entry is
     * mounted without a `t` prop.
     * @param {string} key dictionary key
     * @param {Record<string, unknown>} [values] interpolation values
     * @returns {string} localized text
     */
    function fallbackT(key, values) {
      const language = typeof document !== 'undefined' ? document.documentElement.lang : ''
      const preferred = String(language || (typeof navigator !== 'undefined' ? navigator.language : '')).toLowerCase()
      const dictionary = preferred.startsWith('zh') ? LOCALE.zh : LOCALE.en
      return interpolate(dictionary[key] ?? key, values)
    }

    /**
     * Insert the plugin stylesheet once; the returned disposer removes it.
     * @returns {() => void} cleanup
     */
    function ensureStyle() {
      if (typeof document === 'undefined') return () => {}
      const existing = document.querySelector('style[data-plugin-css=' + JSON.stringify(STYLE_ID) + ']')
      if (existing) return () => {}
      const tag = document.createElement('style')
      tag.dataset.plugin = '@local/prompt-optimizer'
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => {
        tag.remove()
      }
    }

    /**
     * Minimal external store so the two independently mounted slot entries
     * (composer button and overlay dialog) share one dialog state.
     * @param {object} initial initial state
     * @returns {object} store
     */
    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        get() {
          return state
        },
        set(patch) {
          state = Object.assign({}, state, patch)
          for (const listener of Array.from(listeners)) listener()
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        /** Latest stable InputActions of the mounted composer entry. */
        inputActions: null,
        /** In-flight optimize request, aborted when the dialog closes. */
        controller: null,
        /** Element that had focus before the dialog opened. */
        previousFocus: null,
        /** Latest composer facts kept in sync by the mounted trigger. */
        live: null,
      }
    }

    const store = createStore({
      open: false,
      draft: '',
      sessionId: undefined,
      chipCount: 0,
      catalog: null,
      catalogStatus: 'idle',
      catalogError: '',
      provider: '',
      model: '',
      sessionRoute: null,
      view: 'result',
      status: 'idle',
      result: '',
      error: '',
    })

    /** Client plugin context, used to read the per-session model directory. */
    let runtimeContext = null

    /**
     * Subscribe one component to the shared store.
     * @param {object} target store
     * @returns {object} current state
     */
    function useStore(target) {
      const [, bump] = React.useState(0)
      React.useEffect(() => target.subscribe(() => bump((count) => count + 1)), [target])
      return target.get()
    }

    /**
     * Read the saved route preference, ignoring malformed values.
     * @returns {{provider: string, model: string} | undefined} saved route
     */
    function readSavedRoute() {
      try {
        const raw = window.localStorage.getItem(ROUTE_STORAGE_KEY)
        if (!raw) return undefined
        const value = JSON.parse(raw)
        if (value && typeof value.provider === 'string' && typeof value.model === 'string') return value
      } catch {
        /* A missing or corrupt preference only means: use the default route. */
      }
      return undefined
    }

    /**
     * Remember the last route the person picked.
     * @param {string} provider provider id
     * @param {string} model model id
     */
    function saveRoute(provider, model) {
      try {
        window.localStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify({ provider, model }))
      } catch {
        /* Storage can be unavailable; selection still works for this page. */
      }
    }

    /**
     * Find one catalog model and its provider group.
     * @param {object | null} catalog model catalog
     * @param {string} provider provider id
     * @param {string} model model id
     * @returns {boolean} whether the route exists
     */
    function routeExists(catalog, provider, model) {
      if (!catalog || !Array.isArray(catalog.groups)) return false
      return catalog.groups.some(
        (group) => group && group.id === provider && Array.isArray(group.models) && group.models.some((entry) => entry && entry.id === model),
      )
    }

    /**
     * Pick the route the dialog opens with: the session's selected model, then
     * the last choice on this device, then the deployment default, then the
     * first configured model.
     * @param {object | null} catalog model catalog
     * @param {{provider: string, model: string} | null | undefined} preferred session selection
     * @returns {{provider: string, model: string}} selected route
     */
    function pickRoute(catalog, preferred) {
      if (preferred && routeExists(catalog, preferred.provider, preferred.model)) {
        return { provider: preferred.provider, model: preferred.model }
      }
      const saved = readSavedRoute()
      if (saved && routeExists(catalog, saved.provider, saved.model)) return saved
      const fallback = catalog && catalog.default
      if (fallback && routeExists(catalog, fallback.provider, fallback.model)) {
        return { provider: fallback.provider, model: fallback.model }
      }
      if (catalog && Array.isArray(catalog.groups)) {
        for (const group of catalog.groups) {
          if (group && Array.isArray(group.models) && group.models.length > 0) {
            return { provider: group.id, model: group.models[0].id }
          }
        }
      }
      return { provider: '', model: '' }
    }

    /**
     * Read the model the session currently has selected from the composer's own
     * model directory service, so the optimizer starts on the same route the
     * person sees in the model selector.
     * @param {string | undefined} sessionId current Session identity
     * @returns {Promise<{provider: string, model: string} | undefined>} session selection
     */
    async function resolveSessionRoute(sessionId) {
      if (!sessionId || !runtimeContext) return undefined
      try {
        const models = runtimeContext.get('modelDirectories')
        if (!models || typeof models.directoryFor !== 'function') return undefined
        const directory = models.directoryFor(sessionId)
        if (!directory || !directory.store || typeof directory.store.getSnapshot !== 'function') return undefined
        let snapshot = directory.store.getSnapshot()
        if ((!snapshot || !snapshot.current) && typeof directory.load === 'function') snapshot = await directory.load()
        const current = snapshot && snapshot.current
        if (current && typeof current.provider === 'string' && typeof current.model === 'string') {
          return { provider: current.provider, model: current.model }
        }
      } catch {
        /* A resolved directory can be unavailable for subagent sessions. */
      }
      return undefined
    }

    /**
     * Turn any thrown value or failed response into readable text.
     * @param {unknown} value failure
     * @returns {string} message
     */
    function messageOf(value) {
      if (value instanceof Error && value.message) return value.message
      if (typeof value === 'string' && value) return value
      return 'Unexpected failure.'
    }

    /**
     * GET one JSON payload from the Host half.
     * @param {string} url absolute path
     * @returns {Promise<object>} payload
     */
    async function requestJson(url) {
      const response = await fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
      })
      return readResponse(response)
    }

    /**
     * Decode the Host JSON envelope, turning `{ok:false,error}` into a throw.
     * @param {Response} response fetch response
     * @returns {Promise<object>} payload
     */
    async function readResponse(response) {
      let payload
      try {
        payload = await response.json()
      } catch {
        throw new Error(`HTTP ${response.status}`)
      }
      if (!response.ok || !payload || payload.ok !== true) {
        const failure = payload && payload.error ? payload.error : undefined
        if (failure && failure.message) throw new Error(failure.message)
        throw new Error(response.status === 404 ? 'The prompt optimizer Host route is not available (404).' : `HTTP ${response.status}`)
      }
      return payload
    }

    /**
     * Load the configured model catalog (or reuse the loaded one) and pick the
     * initial route for this Session.
     * @param {object} target store
     * @param {string | undefined} sessionId current Session identity
     * @param {boolean} [preferSession] adopt the session selection even over a manual choice
     * @returns {Promise<void>} completion
     */
    async function loadCatalog(target, sessionId, preferSession) {
      const preferred = await resolveSessionRoute(sessionId)
      const existing = target.get().catalog
      if (existing && target.get().catalogStatus === 'ready') {
        const current = target.get()
        const kept = !preferSession && current.provider && current.model && routeExists(existing, current.provider, current.model)
          ? { provider: current.provider, model: current.model }
          : undefined
        const route = kept ?? pickRoute(existing, preferred)
        target.set({ provider: route.provider, model: route.model, sessionRoute: preferred ?? null })
        return
      }
      target.set({ catalogStatus: 'loading', catalogError: '' })
      try {
        const payload = await requestJson(API.models)
        const catalog = {
          default: payload.default && typeof payload.default === 'object' ? payload.default : null,
          groups: Array.isArray(payload.groups) ? payload.groups : [],
          failures: Array.isArray(payload.failures) ? payload.failures : [],
        }
        const route = pickRoute(catalog, preferred)
        target.set({
          catalog,
          catalogStatus: 'ready',
          provider: route.provider,
          model: route.model,
          sessionRoute: preferred ?? null,
        })
      } catch (error) {
        target.set({ catalogStatus: 'error', catalogError: messageOf(error) })
      }
    }

    /**
     * Decode one server-sent-event frame into its JSON payload.
     * @param {string} frame one frame between blank lines
     * @returns {object | undefined} parsed event
     */
    function parseSseFrame(frame) {
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      if (!data) return undefined
      try {
        const value = JSON.parse(data)
        return value && typeof value === 'object' ? value : undefined
      } catch {
        return undefined
      }
    }

    /**
     * Ask the Host half to rewrite the captured draft, updating the preview
     * while the answer streams in.
     * @param {object} target store
     * @returns {Promise<void>} completion
     */
    async function optimize(target) {
      const state = target.get()
      const draft = typeof state.draft === 'string' ? state.draft : ''
      if (draft.trim().length === 0) {
        target.set({ status: 'error', error: 'empty-draft' })
        return
      }
      if (!state.provider || !state.model) {
        target.set({ status: 'error', error: 'no-selection' })
        return
      }
      if (target.controller) target.controller.abort()
      const controller = new AbortController()
      target.controller = controller
      const route = { provider: state.provider, model: state.model }
      target.set({ status: 'running', error: '', result: '', view: 'result' })
      try {
        const response = await fetch(API.optimizeStream, {
          method: 'POST',
          headers: { accept: 'text/event-stream', 'content-type': 'application/json' },
          credentials: 'same-origin',
          cache: 'no-store',
          body: JSON.stringify({
            draft,
            ...route,
            sessionId: typeof state.sessionId === 'string' ? state.sessionId : undefined,
          }),
          signal: controller.signal,
        })
        if (!response.ok) {
          const payload = await response.json().catch(() => null)
          const failure = payload && payload.error ? payload.error : undefined
          throw new Error(failure && failure.message ? failure.message : `HTTP ${response.status}`)
        }
        const contentType = response.headers.get('content-type') ?? ''
        if (!response.body || !contentType.includes('text/event-stream')) {
          const payload = await response.json()
          const text = typeof payload.text === 'string' ? payload.text : ''
          if (!text.trim()) throw new Error('empty-result')
          saveRoute(route.provider, route.model)
          target.set({ status: 'done', result: text, error: '' })
          return
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let text = ''
        let finished = false
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let boundary = buffer.indexOf('\n\n')
          while (boundary >= 0) {
            const frame = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + 2)
            const event = parseSseFrame(frame)
            if (event) {
              if (event.type === 'delta' && typeof event.text === 'string') {
                text += event.text
                const patch = { result: text }
                if (target.get().view === 'original') patch.view = 'result'
                target.set(patch)
              } else if (event.type === 'done') {
                text = typeof event.text === 'string' && event.text.trim() ? event.text : text
                saveRoute(route.provider, route.model)
                target.set({ status: 'done', result: text, error: '' })
                finished = true
              } else if (event.type === 'error') {
                target.set({
                  status: 'error',
                  error: typeof event.message === 'string' && event.message ? event.message : 'request-failed',
                })
                finished = true
              }
            }
            boundary = buffer.indexOf('\n\n')
          }
        }
        if (finished) return
        if (!text.trim()) {
          target.set({ status: 'error', error: 'empty-result' })
          return
        }
        saveRoute(route.provider, route.model)
        target.set({ status: 'done', result: text, error: '' })
      } catch (error) {
        if (controller.signal.aborted) return
        target.set({ status: 'error', error: messageOf(error) })
      } finally {
        if (target.controller === controller) target.controller = null
      }
    }

    /**
     * Write the reviewed result back into the composer.
     * @param {object} target store
     * @param {'replace' | 'insert'} mode write-back mode
     */
    function applyResult(target, mode) {
      const state = target.get()
      const actions = target.inputActions
      const text = typeof state.result === 'string' ? state.result : ''
      if (!text) return
      if (!actions) {
        target.set({ status: 'error', error: 'apply-unavailable' })
        return
      }
      try {
        if (mode === 'replace') {
          actions.setDraft(text)
          closeDialog(target)
          return
        }
        const span = actions.captureInsertion()
        if (!actions.insertText(text, span)) {
          target.set({ status: 'error', error: 'insert-rejected' })
          return
        }
        closeDialog(target)
      } catch (error) {
        target.set({ status: 'error', error: messageOf(error) })
      }
    }

    /**
     * Close the dialog and abandon any in-flight request.
     * @param {object} target store
     */
    function closeDialog(target) {
      if (target.controller) {
        target.controller.abort()
        target.controller = null
      }
      target.set({ open: false, status: 'idle', error: '' })
    }

    /**
     * Open the dialog for the draft currently in the composer.
     * @param {object} target store
     * @param {{draft: string, sessionId: string | undefined, chipCount: number}} captured composer facts
     */
    function openDialog(target, captured) {
      target.set({
        open: true,
        draft: captured.draft,
        sessionId: captured.sessionId,
        chipCount: captured.chipCount,
        sessionRoute: null,
        view: 'result',
        status: 'idle',
        result: '',
        error: '',
      })
      void loadCatalog(target, captured.sessionId, true)
    }

    /** Sparkle mark used by the composer control. */
    function TriggerIcon() {
      return h('svg', {
        viewBox: '0 0 16 16',
        width: 16,
        height: 16,
        'aria-hidden': true,
        fill: 'currentColor',
      },
        h('path', { d: 'M8 1.6l1.35 3.4 3.4 1.35-3.4 1.35L8 11.1 6.65 7.7 3.25 6.35 6.65 5z' }),
        h('path', { d: 'M13 9.6l.7 1.75 1.75.7-1.75.7-.7 1.75-.7-1.75-1.75-.7 1.75-.7z', opacity: 0.85 }),
      )
    }

    /**
     * Composer control: captures the draft and opens the review dialog.
     * @param {object} props slot props
     * @returns {import('react').ReactElement} button
     */
    function Trigger(props) {
      const { useInput, inputActions, sessionId } = props
      const t = typeof props.t === 'function' ? props.t : fallbackT
      const draft = useInput((state) => state.draft)
      const chipCount = useInput((state) => (Array.isArray(state.occurrences) ? state.occurrences.length : 0))
      const phase = useInput((state) => state.phase)
      const busy = phase === 'adjudicating' || phase === 'submitting'
      const open = useStore(store).open

      React.useEffect(() => {
        store.inputActions = inputActions || null
        return () => {
          if (store.inputActions === inputActions) store.inputActions = null
          if (store.get().open) closeDialog(store)
        }
      }, [inputActions])

      React.useEffect(() => {
        store.live = {
          draft: typeof draft === 'string' ? draft : '',
          sessionId: typeof sessionId === 'string' ? sessionId : undefined,
          chipCount,
        }
      }, [draft, sessionId, chipCount])

      return h('button', {
        type: 'button',
        className: 'dsh-po-trigger',
        title: t('triggerWithKeys', { keys: SHORTCUT_KEYS }),
        'aria-label': t('triggerWithKeys', { keys: SHORTCUT_KEYS }),
        'aria-haspopup': 'dialog',
        'aria-expanded': open,
        disabled: busy || !inputActions,
        onMouseDown: (event) => {
          event.preventDefault()
        },
        onClick: () => {
          store.previousFocus = typeof document !== 'undefined' ? document.activeElement : null
          openDialog(store, {
            draft: typeof draft === 'string' ? draft : '',
            sessionId: typeof sessionId === 'string' ? sessionId : undefined,
            chipCount,
          })
        },
      }, h(TriggerIcon))
    }

    /**
     * One row of the model `<select>`: provider groups and their models.
     * @param {object} props component props
     * @returns {import('react').ReactElement[] | null} options
     */
    function ModelOptions({ catalog }) {
      if (!catalog || !Array.isArray(catalog.groups) || catalog.groups.length === 0) return null
      return catalog.groups
        .map((group) => {
          if (!group || !Array.isArray(group.models) || group.models.length === 0) return null
          return h('optgroup', { key: group.id, label: group.name || group.id },
            group.models.map((model) => h('option', {
              key: `${group.id}\u0000${model.id}`,
              value: JSON.stringify([group.id, model.id]),
            }, model.name || model.id)))
        })
        .filter(Boolean)
    }

    /**
     * Overlay dialog: model pick, preview, and explicit write-back.
     * @param {object} props slot props
     * @returns {import('react').ReactElement | null} dialog
     */
    function Dialog(props) {
      const t = typeof props.t === 'function' ? props.t : fallbackT
      const state = useStore(store)
      const open = state.open === true
      const panelRef = React.useRef(null)
      const resultRef = React.useRef(null)

      React.useEffect(() => {
        if (!open) return
        const element = resultRef.current
        if (element && store.get().status === 'running') element.scrollTop = element.scrollHeight
      }, [open, state.result])

      React.useEffect(() => {
        if (!open) return undefined
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            closeDialog(store)
            return
          }
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            const snapshot = store.get()
            if (snapshot.status === 'running') return
            event.preventDefault()
            event.stopPropagation()
            if (snapshot.result) {
              applyResult(store, 'replace')
            } else if (snapshot.catalogStatus === 'ready' && snapshot.provider && snapshot.model && snapshot.draft.trim()) {
              void optimize(store)
            }
            return
          }
          if (event.key !== 'Tab' || !panelRef.current) return
          const focusable = panelRef.current.querySelectorAll(
            'button:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[href],[tabindex]:not([tabindex="-1"])',
          )
          if (focusable.length === 0) return
          const first = focusable[0]
          const last = focusable[focusable.length - 1]
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => {
          document.removeEventListener('keydown', onKeyDown, true)
          const previous = store.previousFocus
          store.previousFocus = null
          if (previous && typeof previous.focus === 'function') {
            try {
              previous.focus()
            } catch {
              /* Restoring focus is best effort. */
            }
          }
        }
      }, [open])

      if (!open) return null

      const catalog = state.catalog
      const groups = catalog && Array.isArray(catalog.groups) ? catalog.groups : []
      const failures = catalog && Array.isArray(catalog.failures) ? catalog.failures : []
      const loading = state.catalogStatus === 'loading' || state.catalogStatus === 'idle'
      const running = state.status === 'running'
      const hasDraft = state.draft.trim().length > 0
      const view = state.view === 'original' || state.view === 'compare' ? state.view : 'result'
      const value = state.provider && state.model ? JSON.stringify([state.provider, state.model]) : ''

      const notes = []
      if (state.catalogStatus === 'error') {
        notes.push(h('p', { className: 'dsh-po-note', 'data-kind': 'error', key: 'catalog-error' },
          t('modelsFailed', { message: state.catalogError })))
      }
      if (state.chipCount > 0) {
        notes.push(h('p', { className: 'dsh-po-note', 'data-kind': 'warn', key: 'chip-warning' },
          t('chipWarning', { count: state.chipCount })))
      }
      if (failures.length > 0) {
        notes.push(h('p', { className: 'dsh-po-note', key: 'provider-failures' },
          failures.map((entry) => t('providerFailure', { name: entry.name || entry.id, message: entry.message })).join(' · ')))
      }
      if (state.error) {
        notes.push(h('p', { className: 'dsh-po-note', 'data-kind': 'error', key: 'failure' }, errorText(t, state.error)))
      }

      const canOptimize = !running && state.catalogStatus === 'ready' && Boolean(state.provider && state.model) && hasDraft
      const rows = []

      rows.push(h('div', { className: 'dsh-po-row', key: 'model' },
        h('label', { className: 'dsh-po-label', htmlFor: 'dsh-po-model' }, t('model')),
        h('select', {
          id: 'dsh-po-model',
          className: 'dsh-po-select',
          value,
          disabled: running || loading || groups.length === 0,
          onChange: (event) => {
            try {
              const pair = JSON.parse(event.currentTarget.value)
              store.set({ provider: String(pair[0]), model: String(pair[1]), error: '' })
            } catch {
              /* An unparsable option can only come from a corrupt catalog. */
            }
          },
        },
        groups.length === 0
          ? h('option', { value: '' }, loading ? t('loadingModels') : t('noModels'))
          : h(ModelOptions, { catalog }),
        ),
        h('button', {
          type: 'button',
          className: 'dsh-po-iconbtn',
          title: t('refresh'),
          'aria-label': t('refresh'),
          disabled: running || loading,
          onClick: () => {
            void loadCatalog(store, store.get().sessionId)
          },
        }, '↻'),
      ))

      if (state.sessionRoute && state.provider === state.sessionRoute.provider && state.model === state.sessionRoute.model) {
        rows.push(h('p', { className: 'dsh-po-hint', key: 'session-route' }, t('followSession')))
      }

      const resultBox = (key) => h('textarea', {
        key,
        ref: resultRef,
        id: 'dsh-po-result',
        className: 'dsh-po-textarea',
        value: state.result,
        spellCheck: false,
        placeholder: t('noResultYet'),
        onChange: (event) => store.set({ result: event.currentTarget.value }),
      })

      const tabButton = (id, label) => h('button', {
        key: id,
        type: 'button',
        className: 'dsh-po-tab',
        role: 'tab',
        'data-active': view === id ? 'true' : 'false',
        'aria-selected': view === id,
        onClick: () => store.set({ view: id }),
      }, label)

      if (hasDraft) {
        rows.push(h('div', { className: 'dsh-po-tabs', role: 'tablist', key: 'tabs' },
          tabButton('result', t('tabResult')),
          tabButton('original', t('tabOriginal')),
          tabButton('compare', t('tabCompare')),
        ))
        if (view === 'result') {
          const length = state.result ? state.result.length : state.draft.length
          rows.push(h('div', { className: 'dsh-po-pane', key: 'pane-result' },
            h('span', { className: 'dsh-po-paneLabel' }, `${t('resultLabel')} · ${t('chars', { count: length })}`),
            resultBox('result'),
          ))
        } else if (view === 'original') {
          rows.push(h('pre', { className: 'dsh-po-preFrame', key: 'pane-original' }, state.draft))
        } else {
          rows.push(h('div', { className: 'dsh-po-compare', key: 'pane-compare' },
            h('div', { className: 'dsh-po-pane' },
              h('span', { className: 'dsh-po-paneLabel' }, t('paneOriginal')),
              h('pre', { className: 'dsh-po-preFrame' }, state.draft),
            ),
            h('div', { className: 'dsh-po-pane' },
              h('span', { className: 'dsh-po-paneLabel' }, t('paneResult')),
              resultBox('result-compare'),
            ),
          ))
        }
      } else {
        rows.push(h('p', { className: 'dsh-po-note', 'data-kind': 'warn', key: 'empty-draft' }, t('emptyDraft')))
      }

      if (running) {
        rows.push(h('div', { className: 'dsh-po-status', key: 'running' },
          h('span', { className: 'dsh-po-spin', 'aria-hidden': true }),
          state.result ? t('streamingHint') : t('optimizing')))
      } else if (state.status === 'done') {
        rows.push(h('p', { className: 'dsh-po-hint', key: 'done' }, t('doneHint')))
      }

      for (const note of notes) rows.push(note)

      const footer = [
        h('span', { className: 'dsh-po-hint', key: 'shortcut-hint' }, t('shortcutHint', { keys: SHORTCUT_KEYS })),
        h('span', { className: 'dsh-po-spacer', key: 'spacer' }),
      ]
      footer.push(h('button', {
        type: 'button',
        className: 'dsh-po-btn',
        key: 'cancel',
        onClick: () => closeDialog(store),
      }, t('cancel')))

      if (state.result) {
        footer.push(h('button', {
          type: 'button',
          className: 'dsh-po-btn',
          key: 'again',
          disabled: running,
          onClick: () => {
            void optimize(store)
          },
        }, t('again')))
        footer.push(h('button', {
          type: 'button',
          className: 'dsh-po-btn',
          key: 'insert',
          disabled: running,
          onClick: () => applyResult(store, 'insert'),
        }, t('insert')))
        footer.push(h('button', {
          type: 'button',
          className: 'dsh-po-btn',
          'data-variant': 'primary',
          key: 'replace',
          title: `${t('replace')} (${SUBMIT_KEYS})`,
          disabled: running,
          onClick: () => applyResult(store, 'replace'),
        }, t('replace')))
      } else {
        footer.push(h('button', {
          type: 'button',
          className: 'dsh-po-btn',
          'data-variant': 'primary',
          key: 'optimize',
          autoFocus: true,
          title: `${t('optimize')} (${SUBMIT_KEYS})`,
          disabled: !canOptimize,
          onClick: () => {
            void optimize(store)
          },
        }, running ? t('optimizing') : t('optimize')))
      }

      return h('div', {
        className: 'dsh-po-overlay',
        onMouseDown: (event) => {
          if (event.target === event.currentTarget) closeDialog(store)
        },
      }, h('div', {
        className: 'dsh-po-panel',
        ref: panelRef,
        role: 'dialog',
        'aria-modal': true,
        'aria-label': t('title'),
      },
      h('div', { className: 'dsh-po-header' },
        h('h2', { className: 'dsh-po-title' }, t('title')),
        h('button', {
          type: 'button',
          className: 'dsh-po-iconbtn',
          title: t('close'),
          'aria-label': t('close'),
          onClick: () => closeDialog(store),
        }, '×'),
      ),
      h('div', { className: 'dsh-po-body' },
        h('p', { className: 'dsh-po-hint' }, t('subtitle')),
        rows,
      ),
      h('div', { className: 'dsh-po-footer' }, footer),
      ))
    }

    /**
     * Render one stored failure code or raw Host message.
     * @param {(key: string, values?: Record<string, unknown>) => string} t translator
     * @param {string} error stored failure
     * @returns {string} localized text
     */
    function errorText(t, error) {
      if (error === 'empty-draft') return t('emptyDraft')
      if (error === 'no-selection') return t('noSelection')
      if (error === 'empty-result') return t('emptyResult')
      if (error === 'insert-rejected') return t('insertRejected')
      if (error === 'apply-unavailable') return t('applyUnavailable')
      return t('error', { message: error })
    }

    /**
     * Register the chord that opens the dialog for the composer's current
     * draft. A missing shortcut service or a colliding default only costs the
     * shortcut: the button and dialog keep working.
     * @param {object} ctx client plugin context
     */
    function registerShortcut(ctx) {
      try {
        ctx.inject(['shortcuts'], (scope) => {
          const translate = typeof scope.locale?.bind === 'function' ? scope.locale.bind(NS) : fallbackT
          try {
            scope.effect(() => scope.shortcuts.register({
              id: 'prompt-optimizer.open',
              label: () => translate('shortcutOpen'),
              aliases: ['optimize prompt', 'prompt optimizer', '提示词优化', '优化提示词'],
              defaults: {
                'desktop:macos': { code: 'KeyU', modifiers: ['primary', 'shift'] },
                'desktop:windows': { code: 'KeyU', modifiers: ['primary', 'shift'] },
                'desktop:linux': { code: 'KeyU', modifiers: ['primary', 'shift'] },
                'web:macos': { code: 'KeyU', modifiers: ['primary', 'shift'] },
                'web:windows': { code: 'KeyU', modifiers: ['primary', 'shift'] },
                'web:linux': { code: 'KeyU', modifiers: ['primary', 'shift'] },
              },
              regions: ['page', 'editable'],
              modals: [],
              resolve: () => {
                const live = store.live
                if (!live || !live.sessionId || !store.inputActions) return { status: 'pass' }
                return {
                  status: 'handled',
                  run: () => {
                    if (typeof document !== 'undefined') store.previousFocus = document.activeElement
                    openDialog(store, live)
                  },
                }
              },
            }))
          } catch (error) {
            console.warn('[prompt-optimizer] shortcut registration skipped:', error)
          }
        })
      } catch (error) {
        console.warn('[prompt-optimizer] shortcuts service unavailable:', error)
      }
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        runtimeContext = ctx
        ctx.effect(() => ensureStyle())
        ctx.effect(() => ctx.locale.register(NS, { zh: LOCALE.zh, en: LOCALE.en }))
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'prompt-optimizer',
          order: 10,
          locale: NS,
        }, Trigger))
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'prompt-optimizer-dialog',
          order: 40,
          locale: NS,
        }, Dialog))
        registerShortcut(ctx)
      },
    }
  },
})
