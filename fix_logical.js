const fs = require('fs')
let code = fs.readFileSync('frontend/src/composables/useReaderAutoPlayback.ts', 'utf-8')

const logicalFns = `
  function getNextLogicalParagraphFrom(current: HTMLElement | null) {
    const list = getAllParagraphs()
    const index = current ? list.indexOf(current) : -1
    if (index >= 0) {
      const currentOriginalIndex = current?.getAttribute('data-original-index')
      if (currentOriginalIndex !== null && currentOriginalIndex !== '') {
        for (let i = index + 1; i < list.length; i++) {
          if (list[i].getAttribute('data-original-index') !== currentOriginalIndex) {
            return list[i]
          }
        }
      }
      return list[index + 1] || null
    }
    return list[0] || null
  }

  function getPrevLogicalParagraphFrom(current: HTMLElement | null) {
    const list = getAllParagraphs()
    const index = current ? list.indexOf(current) : -1
    if (index > 0) {
      const currentOriginalIndex = current?.getAttribute('data-original-index')
      if (currentOriginalIndex !== null && currentOriginalIndex !== '') {
        for (let i = index - 1; i >= 0; i--) {
          if (list[i].getAttribute('data-original-index') !== currentOriginalIndex) {
            const prevOriginalIndex = list[i].getAttribute('data-original-index')
            for (let j = i; j >= 0; j--) {
              if (list[j].getAttribute('data-original-index') !== prevOriginalIndex) {
                return list[j + 1]
              }
            }
            return list[0]
          }
        }
      }
      return list[index - 1]
    }
    return null
  }
`

code = code.replace('  function getNextParagraph() {', logicalFns + '\n  function getNextParagraph() {')

code = code.replace('const next = forcedNext ?? getNextParagraph()', 'const next = forcedNext ?? getNextLogicalParagraphFrom(getCurrentParagraph())')
code = code.replace('const prev = getPrevParagraph()', 'const prev = getPrevLogicalParagraphFrom(getCurrentParagraph())')

fs.writeFileSync('frontend/src/composables/useReaderAutoPlayback.ts', code)
