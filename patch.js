const fs = require('fs')
const path = 'frontend/src/stores/reader.ts'
let code = fs.readFileSync(path, 'utf8')

const target = `    if (invokeTTS('play', {
      sentences: (() => {
        const sentences: {
          text: string;
          originalIndex: number;
          slices: { sliceIndex: number; charStart: number; charLength: number }[];
        }[] = [];
        let currentSentence: typeof sentences[0] | null = null;

        document.querySelectorAll('.chapter-text p').forEach(p => {
          const idx = p.getAttribute('data-original-index');
          if (idx === null) return;
          const originalIndex = parseInt(idx, 10);

          const t = (p as HTMLElement).innerText.replace(/\\n/g, ' ').trim();
          // Plan v1.1: Web 权威单向清洗，统一完成标点清洗与空段剔除
          if (!t) return;

          const sliceIdxStr = p.getAttribute('data-slice-index');
          const sliceIndex = sliceIdxStr !== null ? parseInt(sliceIdxStr, 10) : 0;

          if (currentSentence && currentSentence.originalIndex === originalIndex) {
            const charStart = currentSentence.text.length;
            currentSentence.text += t;
            currentSentence.slices.push({
              sliceIndex,
              charStart,
              charLength: t.length
            });
          } else {
            currentSentence = {
              text: t,
              originalIndex,
              slices: [{
                sliceIndex,
                charStart: 0,
                charLength: t.length
              }]
            };
            sentences.push(currentSentence);
          }
        });

        // Plan v1.1: Web 权威单向清洗, filter pure symbol sentences
        return sentences.filter(s => !/^[\\s\\p{P}\\p{S}]+$/u.test(s.text));
      })(),
      text: rawText, // Keep fallback for older Native implementations`

const replacement = `    let finalSentences: any[] = []
    if (invokeTTS('play', {
      sentences: (() => {
        const sentences: {
          text: string;
          originalIndex: number;
          slices: { sliceIndex: number; charStart: number; charLength: number }[];
        }[] = [];
        let currentSentence: typeof sentences[0] | null = null;
        
        let rootSelector = '.chapter-text'
        if (appStore.isContinuousMode) {
          rootSelector = \`.continuous-chapter[data-chapter-index="\${currentIndex.value}"] .chapter-text\`
        }
        const root = document.querySelector(rootSelector)
        if (!root) return []

        root.querySelectorAll('p').forEach(p => {
          const idx = p.getAttribute('data-original-index');
          if (idx === null) return;
          const originalIndex = parseInt(idx, 10);

          const t = (p as HTMLElement).innerText.replace(/\\n/g, ' ').trim();
          if (!t) return;

          const sliceIdxStr = p.getAttribute('data-slice-index');
          const sliceIndex = sliceIdxStr !== null ? parseInt(sliceIdxStr, 10) : 0;

          if (currentSentence && currentSentence.originalIndex === originalIndex) {
            const charStart = currentSentence.text.length;
            currentSentence.text += t;
            currentSentence.slices.push({
              sliceIndex,
              charStart,
              charLength: t.length
            });
          } else {
            currentSentence = {
              text: t,
              originalIndex,
              slices: [{
                sliceIndex,
                charStart: 0,
                charLength: t.length
              }]
            };
            sentences.push(currentSentence);
          }
        });

        finalSentences = sentences.filter(s => !/^[\\s\\p{P}\\p{S}]+$/u.test(s.text));
        return finalSentences;
      })(),
      text: finalSentences.length > 0 ? finalSentences.map(s => s.text).join('\\n') : rawText,`

code = code.replace(target, replacement)
fs.writeFileSync(path, code)
