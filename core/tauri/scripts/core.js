// Copyright 2019-2021 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

;
(function () {
  function uid() {
    const length = new Int8Array(1)
    window.crypto.getRandomValues(length)
    const array = new Uint8Array(Math.max(16, Math.abs(length[0])))
    window.crypto.getRandomValues(array)
    return array.join('')
  }

  if (!window.__TAURI__) {
    window.__TAURI__ = {}
  }

  window.__TAURI__.transformCallback = function transformCallback(
    callback,
    once
  ) {
    var identifier = uid()

    window[identifier] = function (result) {
      if (once) {
        delete window[identifier]
      }

      return callback && callback(result)
    }

    return identifier
  }

  window.__TAURI_INVOKE__ = function invoke(cmd, args = {}, key = null) {
    return new Promise(function (resolve, reject) {
      var callback = window.__TAURI__.transformCallback(function (r) {
        resolve(r)
        delete window[error]
      }, true)
      var error = window.__TAURI__.transformCallback(function (e) {
        reject(e)
        delete window[callback]
      }, true)

      if (typeof cmd === 'string') {
        args.cmd = cmd
      } else if (typeof cmd === 'object') {
        args = cmd
      } else {
        return reject(new Error('Invalid argument type.'))
      }

      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        window.__TAURI_POST_MESSAGE__(
          cmd, {
            ...args,
            callback: callback,
            error: error,
            __invokeKey: key || __TAURI_INVOKE_KEY__
          }
        )
      } else {
        window.addEventListener('DOMContentLoaded', function () {
          window.__TAURI_POST_MESSAGE__(
            cmd, {
              ...args,
              callback: callback,
              error: error,
              __invokeKey: key || __TAURI_INVOKE_KEY__
            }
          )
        })
      }
    })
  }

  // open <a href="..."> links with the Tauri API
  function __openLinks() {
    document.querySelector('body').addEventListener(
      'click',
      function (e) {
        var target = e.target
        while (target != null) {
          if (target.matches('a')) {
            if (
              target.href &&
              target.href.startsWith('http') &&
              target.target === '_blank'
            ) {
              window.__TAURI_INVOKE__(
                'tauri', {
                  __tauriModule: 'Shell',
                  message: {
                    cmd: 'open',
                    path: target.href
                  }
                },
                _KEY_VALUE_
              )
              e.preventDefault()
            }
            break
          }
          target = target.parentElement
        }
      },
      true
    )
  }

  if (
    document.readyState === 'complete' ||
    document.readyState === 'interactive'
  ) {
    __openLinks()
  } else {
    window.addEventListener(
      'DOMContentLoaded',
      function () {
        __openLinks()
      },
      true
    )
  }

  // drag region
  document.addEventListener('mousedown', (e) => {
    if (e.target.hasAttribute('data-tauri-drag-region') && e.buttons === 1) {
      // start dragging if the element has a `tauri-drag-region` data attribute and maximize on double-clicking it
      window.__TAURI_INVOKE__(
        'tauri', {
          __tauriModule: 'Window',
          message: {
            cmd: 'manage',
            data: {
              cmd: {
                type: e.detail === 2 ? '__toggleMaximize' : 'startDragging'
              }
            }
          }
        },
        _KEY_VALUE_
      )
    }
  })

  window.__TAURI_INVOKE__(
    'tauri', {
      __tauriModule: 'Event',
      message: {
        cmd: 'listen',
        event: 'tauri://window-created',
        handler: window.__TAURI__.transformCallback(function (event) {
          if (event.payload) {
            var windowLabel = event.payload.label
            window.__TAURI__.__windows.push({
              label: windowLabel
            })
          }
        })
      }
    },
    _KEY_VALUE_
  )

  let permissionSettable = false
  let permissionValue = 'default'

  function isPermissionGranted() {
    if (window.Notification.permission !== 'default') {
      return Promise.resolve(window.Notification.permission === 'granted')
    }
    return window.__TAURI_INVOKE__(
      'tauri', {
        __tauriModule: 'Notification',
        message: {
          cmd: 'isNotificationPermissionGranted'
        }
      },
      _KEY_VALUE_
    )
  }

  function setNotificationPermission(value) {
    permissionSettable = true
    window.Notification.permission = value
    permissionSettable = false
  }

  function requestPermission() {
    return window
      .__TAURI_INVOKE__(
        'tauri', {
          __tauriModule: 'Notification',
          message: {
            cmd: 'requestNotificationPermission'
          }
        },
        _KEY_VALUE_
      )
      .then(function (permission) {
        setNotificationPermission(permission)
        return permission
      })
  }

  function sendNotification(options) {
    if (typeof options === 'object') {
      Object.freeze(options)
    }

    isPermissionGranted().then(function (permission) {
      if (permission) {
        return window.__TAURI_INVOKE__(
          'tauri', {
            __tauriModule: 'Notification',
            message: {
              cmd: 'notification',
              options: typeof options === 'string' ? {
                title: options
              } : options
            }
          },
          _KEY_VALUE_
        )
      }
    })
  }

  window.Notification = function (title, options) {
    var opts = options || {}
    sendNotification(
      Object.assign(opts, {
        title: title
      })
    )
  }

  window.Notification.requestPermission = requestPermission

  Object.defineProperty(window.Notification, 'permission', {
    enumerable: true,
    get: function () {
      return permissionValue
    },
    set: function (v) {
      if (!permissionSettable) {
        throw new Error('Readonly property')
      }
      permissionValue = v
    }
  })

  isPermissionGranted().then(function (response) {
    if (response === null) {
      setNotificationPermission('default')
    } else {
      setNotificationPermission(response ? 'granted' : 'denied')
    }
  })

  window.alert = function (message) {
    window.__TAURI_INVOKE__(
      'tauri', {
        __tauriModule: 'Dialog',
        message: {
          cmd: 'messageDialog',
          message: message
        }
      },
      _KEY_VALUE_
    )
  }

  window.confirm = function (message) {
    return window.__TAURI_INVOKE__(
      'tauri', {
        __tauriModule: 'Dialog',
        message: {
          cmd: 'confirmDialog',
          message: message
        }
      },
      _KEY_VALUE_
    )
  }

  // window.print works on Linux/Windows; need to use the API on macOS
  if (navigator.userAgent.includes('Mac')) {
    window.print = function () {
      return window.__TAURI_INVOKE__(
        'tauri', {
          __tauriModule: 'Window',
          message: {
            cmd: 'manage',
            data: {
              cmd: {
                type: 'print'
              }
            }
          }
        },
        _KEY_VALUE_
      )
    }
  }
})()
