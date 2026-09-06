import re

html = """
<div>
  <h2>第4章</h2>
  <p>再见许思...</p>
  <br>
  <p>第二天...</p>
</div>
"""

p_tags = re.findall(r'<p[^>]*>(.*?)</p>', html, re.IGNORECASE | re.DOTALL)
print(p_tags)
