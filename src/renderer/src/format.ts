/** 日期、时间与数字统一走 Intl，随界面语言变化。 */
export function formatDateTime(
  value: string | number | Date,
  language: string,
): string {
  return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function formatNumber(value: number, language: string): string {
  return new Intl.NumberFormat(language === 'en' ? 'en-US' : 'zh-CN').format(value)
}
