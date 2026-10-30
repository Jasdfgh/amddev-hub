"""Read HTML only. JSON goes through a pipe to the redacting JS mapper."""
from html.parser import HTMLParser
from pathlib import Path
import json
import sys

VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}

class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack = []
        self.current = None
        self.links = []

    def handle_starttag(self, tag, pairs):
        attrs = dict(pairs)
        if tag == 'a' or (tag == 'button' and attrs.get('data-track-href')):
            ancestors = self.stack + [(tag, attrs)]
            ids = [a.get('id', '') for _, a in ancestors]
            tags = [t for t, _ in ancestors]
            classes = ' '.join(a.get('class', '') for _, a in ancestors)
            placement = '其他位置'
            if 'hero-actions' in classes: placement = '首屏'
            elif 'header' in tags: placement = '顶栏'
            elif 'footer' in tags: placement = '页脚'
            elif 'community-group' in ids: placement = '技术群区域'
            elif 'technical-support' in ids or 'support' in ids: placement = '反馈与支持'
            elif 'reads' in ids: placement = '学习与社区内容'
            elif 'insights' in ids: placement = '分享与交流'
            elif 'channels' in ids: placement = '平台卡片'
            self.current = {'href': attrs.get('href') or attrs.get('data-track-href', ''), 'download': 'download' in attrs,
                            'attrs': {k:v for k,v in attrs.items() if k.startswith('data-track-')},
                            'placement': placement, 'role': '技术支持' if 'technical-support' in ids else '',
                            '_tag': tag, '_title': attrs.get('aria-label') or attrs.get('title'), '_heading': [], '_text': []}
        if tag not in VOID:
            self.stack.append((tag, attrs))

    def handle_data(self, value):
        if self.current is None: return
        if any(t == 'svg' or a.get('aria-hidden') == 'true' for t,a in self.stack): return
        self.current['_text'].append(value)
        if any(t in ('h2', 'h3') for t,_ in self.stack): self.current['_heading'].append(value)

    def handle_endtag(self, tag):
        if self.current and tag == self.current['_tag']:
            item = self.current
            label = item.pop('_title') or ''.join(item.pop('_heading')) or ''.join(item['_text'])
            item.pop('_heading', None)
            item.pop('_text', None)
            item.pop('_tag')
            item['label'] = ' '.join(label.split())[:160]
            self.links.append(item)
            self.current = None
        for index in range(len(self.stack)-1, -1, -1):
            if self.stack[index][0] == tag:
                self.stack = self.stack[:index]
                break

parser = Links()
parser.feed(Path(sys.argv[1]).read_text())
sys.stdout.write(json.dumps(parser.links, ensure_ascii=False))
