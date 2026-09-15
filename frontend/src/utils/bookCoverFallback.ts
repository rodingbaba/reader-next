/**
 * 从书名中提取作为封面占位的首个字符
 * 规则：优先提取第一个非符号的中文字（汉字）；若无中文字符，提取第一个字母或数字；兜底为 '书'
 */
export function getBookInitial(name?: string | null): string {
  if (!name) return '书'

  // 1. 优先提取第一个非符号的中文字（CJK 统一表意文字）
  const hanMatch = name.match(/[\p{Script=Han}]/u)
  if (hanMatch) {
    return hanMatch[0]
  }

  // 2. 若无中文字符，提取第一个字母或数字
  const wordMatch = name.match(/[\p{L}\p{N}]/u)
  if (wordMatch) {
    return wordMatch[0].toUpperCase()
  }

  // 3. 兜底为 '书'
  return '书'
}

