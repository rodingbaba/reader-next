const fs = require('fs')
let code = fs.readFileSync('frontend/src/composables/useReaderAutoPlayback.ts', 'utf-8')

code = code.replace(/  function getPrevParagraph\(\) \{\n    const current = getCurrentParagraph\(\)\n    return getPrevParagraphFrom\(current\)\n  \}\n\n/, '')

fs.writeFileSync('frontend/src/composables/useReaderAutoPlayback.ts', code)
