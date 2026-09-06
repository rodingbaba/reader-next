import Foundation

func removeSVGTags(_ text: String) -> String {
    var result = text
    let htmlPattern = "<[^>]+>"
    if let htmlRegex = try? NSRegularExpression(pattern: htmlPattern, options: []) {
        let range = NSRange(location: 0, length: result.utf16.count)
        result = htmlRegex.stringByReplacingMatches(in: result, options: [], range: range, withTemplate: "")
    }
    result = result.replacingOccurrences(of: "&nbsp;", with: " ")
    return result
}

func splitTextIntoSentences(_ text: String) -> [String] {
    let htmlPattern = "<[a-z][\\s\\S]*?>"
    let hasHtml = text.range(of: htmlPattern, options: [.regularExpression, .caseInsensitive]) != nil
    
    var rawParagraphs: [String] = []
    
    if hasHtml {
        let pPattern = "<p[^>]*>(.*?)</p>"
        if let regex = try? NSRegularExpression(pattern: pPattern, options: [.caseInsensitive, .dotMatchesLineSeparators]) {
            let matches = regex.matches(in: text, options: [], range: NSRange(location: 0, length: text.utf16.count))
            for match in matches {
                if let range = Range(match.range(at: 1), in: text) {
                    rawParagraphs.append(String(text[range]))
                }
            }
        }
    }
    
    if rawParagraphs.isEmpty {
        rawParagraphs = text.components(separatedBy: "\n")
    }
    
    var result: [String] = []
    for p in rawParagraphs {
        var clean = removeSVGTags(p)
        clean = clean.trimmingCharacters(in: .whitespacesAndNewlines)
        if !clean.isEmpty {
            result.append(clean)
        }
    }
    
    return result
}

let html = """
<div>
  <h2>第4章</h2>
  <p>再见许思...</p>
  <br>
  <p>第二天... <b>粗体</b></p>
  <p>   </p>
</div>
"""

print(splitTextIntoSentences(html))
