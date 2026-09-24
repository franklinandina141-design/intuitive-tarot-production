// User-facing pay / result CTA copy. ALL lines must stay punctuation-free
// (no ，。！？：；、—～… "" '' （） · and no Western , . ! ? : ; - ~).
// Keep ♡ ¥ numbers and structural ｜ in button labels.

const PAY_COPY = Object.freeze({
  resultHasFree: Object.freeze({
    lines: Object.freeze([
      '牌先看到这里啦',
      '你把心事说清楚本身就已经往前走了一步',
      '若还想接着问小女巫还在牌桌等你 ♡'
    ])
  }),
  resultExhausted: Object.freeze({
    lines: Object.freeze([
      '今天这副牌小女巫已经尽心翻完了',
      '若你觉得被听懂了一点欢迎给牌桌续杯下次抽牌我还在'
    ]),
    primaryButton: '续杯 5 次｜¥29.9',
    secondaryButton: '先只要 1 次｜¥9.9',
    finePrint: '虚拟服务 仅供自我觉察与娱乐参考'
  }),
  paywall: Object.freeze({
    title: '给小女巫续一杯',
    subtitle: '把下次想问的事留在牌桌上',
    primaryButton: '续杯 5 次｜¥29.9',
    primaryHint: '比单次更香',
    secondaryButton: '先续 1 次｜¥9.9',
    paySuccess: '续杯成功牌桌亮了我们下次见 ♡',
    payFail: '这杯还没续上次数没动想续的时候再来就好'
  })
});

module.exports = {PAY_COPY};
