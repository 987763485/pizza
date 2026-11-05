// 在 React 挂载前应用主进程传入的主题与语言，避免首屏闪烁。
;(function () {
  var boot = window.pizzaBootstrap || {}
  var root = document.documentElement
  root.dataset.theme = boot.theme || 'light'
  if (boot.language) root.lang = boot.language
})()
