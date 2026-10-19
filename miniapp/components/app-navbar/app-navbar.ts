Component({
  properties: {
    title: {
      type: String,
      value: '',
    },
    /**
     * 是否显示返回按钮。
     * - 不传（null）：按页面栈自动判断，栈深 > 1 显示；
     * - 显式 true / false：覆盖自动判断。
     */
    back: {
      type: null,
      value: null,
    },
  },

  data: {
    showBack: false,
  },

  lifetimes: {
    attached() {
      const explicit = this.properties.back
      const stackDepth = getCurrentPages().length
      this.setData({
        showBack: explicit === null ? stackDepth > 1 : !!explicit,
      })
    },
  },

  methods: {
    onBack() {
      // 栈深 > 1 正常返回；栈深为 1（扫码/分享直达）时回首页，避免按钮点了没反应
      if (getCurrentPages().length > 1) {
        wx.navigateBack({ delta: 1 })
        return
      }
      wx.switchTab({ url: '/pages/index/index' })
    },
  },
})
