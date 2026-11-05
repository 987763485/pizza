(function () {
  const root = document.documentElement
  const zh = (root.lang || '').toLowerCase().startsWith('zh')
  const storageKey = 'pizza-docs-theme'

  function resolvedTheme() {
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored === 'dark' || stored === 'light') return stored
    } catch {
      // Storage may be unavailable in private contexts; fall back to the system theme.
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  function applyTheme(theme) {
    root.dataset.theme = theme
    const toggle = document.querySelector('[data-theme-toggle]')
    if (toggle) {
      toggle.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false')
      toggle.setAttribute('aria-label', zh ? '切换深浅色主题' : 'Toggle color theme')
      toggle.setAttribute('title', zh ? '切换深浅色主题' : 'Toggle color theme')
    }
  }

  applyTheme(resolvedTheme())

  const themeToggle = document.querySelector('[data-theme-toggle]')
  if (themeToggle) {
    themeToggle.addEventListener('click', function () {
      const next = root.dataset.theme === 'dark' ? 'light' : 'dark'
      applyTheme(next)
      try {
        localStorage.setItem(storageKey, next)
      } catch {
        // Ignore storage errors; the theme still applies for this visit.
      }
    })
  }

  const sections = Array.from(document.querySelectorAll('main .doc-section[id]'))
  const sectionLinks = Array.from(document.querySelectorAll('.docs-sidebar a[href^="#"]'))
  const tocLinks = Array.from(document.querySelectorAll('.docs-toc a[href^="#"]'))
  const toTop = document.querySelector('[data-to-top]')

  function setActive(id) {
    sectionLinks.forEach(function (link) {
      const active = link.getAttribute('href') === '#' + id
      link.classList.toggle('active', active)
      if (active) link.setAttribute('aria-current', 'true')
      else link.removeAttribute('aria-current')
    })
    tocLinks.forEach(function (link) {
      const active = link.getAttribute('href') === '#' + id
      link.classList.toggle('active', active)
      if (active) link.setAttribute('aria-current', 'true')
      else link.removeAttribute('aria-current')
    })
  }

  function updateScrollState() {
    if (!sections.length) return
    const atBottom =
      Math.ceil(window.innerHeight + window.scrollY) >=
      document.documentElement.scrollHeight - 2
    let current = atBottom ? sections[sections.length - 1].id : sections[0].id
    if (!atBottom) {
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= 120) current = section.id
        else break
      }
    }
    setActive(current)
    if (toTop) toTop.classList.toggle('visible', window.scrollY > 720)
  }

  let ticking = false
  window.addEventListener(
    'scroll',
    function () {
      if (ticking) return
      ticking = true
      window.requestAnimationFrame(function () {
        updateScrollState()
        ticking = false
      })
    },
    { passive: true },
  )
  updateScrollState()

  if (toTop) {
    toTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    })
  }

  const copyLabel = zh ? '复制' : 'Copy'
  const copiedLabel = zh ? '已复制' : 'Copied'
  document.querySelectorAll('pre').forEach(function (pre) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'copy-btn'
    button.textContent = copyLabel
    button.setAttribute('aria-label', zh ? '复制代码' : 'Copy code')
    button.addEventListener('click', function () {
      const code = pre.querySelector('code')
      const text = (code || pre).textContent || ''
      const done = function () {
        button.textContent = copiedLabel
        window.setTimeout(function () {
          button.textContent = copyLabel
        }, 1600)
      }
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done).catch(function () {
          fallbackCopy(text, done)
        })
      } else {
        fallbackCopy(text, done)
      }
    })
    pre.appendChild(button)
  })

  function fallbackCopy(text, done) {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    try {
      document.execCommand('copy')
      done()
    } catch {
      // Nothing else to try; leave the code selected for manual copying.
    }
    document.body.removeChild(textarea)
  }
})()
