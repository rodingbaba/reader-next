const fs = require('fs')
let code = fs.readFileSync('frontend/src/composables/useReaderAutoPlayback.ts', 'utf-8')

code = code.replace(/  function getPrevParagraphFrom\(current: HTMLElement \| null\) \{\n    const list = getAllParagraphs\(\)\n    const index = current \? list\.indexOf\(current\) : -1\n    if \(index > 0\) return list\[index - 1\]\n    return null\n  \}\n\n/, '')

fs.writeFileSync('frontend/src/composables/useReaderAutoPlayback.ts', code)
