"""Merge JSON source blocks of research/A*.md into research/sources.json.
Writes key_map.json: {agent: {old_key: canonical_key}}."""
import json,re,glob,collections,sys
R='/home/user/GeoFlight/research'
ORDER=['A2','A1','A3b','A3a','A3c','A4']
def arxiv(u):
    m=re.search(r'arxiv\.org/(?:abs|pdf|html)/(\d{4}\.\d{4,5})',u or '')
    return m.group(1) if m else None
def ntitle(t):
    t=re.sub(r'[^a-z0-9]','',(t or '').lower()); return t[:50]
def nurl(u):
    u=(u or '').strip().lower().rstrip('/')
    return re.sub(r'^https?://(www\.)?','',u)
srcs=[]
for f in glob.glob(R+'/A*.md'):
    ag=f.split('/')[-1].split('_')[0]
    t=open(f).read()
    js=json.loads(re.findall(r'```json\s*\n(.*?)\n```',t,re.S)[-1])
    for s in js: s['_agent']=ag; srcs.append(s)
srcs.sort(key=lambda s:ORDER.index(s['_agent']))
# union-find on identities
parent=list(range(len(srcs)))
def find(i):
    while parent[i]!=i: parent[i]=parent[parent[i]]; i=parent[i]
    return i
idx=collections.defaultdict(list)
GENERIC={'colmap.github.io','github.com/colmap/colmap'}
for i,s in enumerate(srcs):
    a=arxiv(s.get('url'))
    if a: idx['ax:'+a].append(i)
    if s.get('doi'): idx['doi:'+s['doi'].lower()].append(i)
    nt=ntitle(s.get('title'))
    if len(nt)>=20: idx['t:'+nt].append(i)
    nu=nurl(s.get('url'))
    if nu and nu not in GENERIC: idx['u:'+nu].append(i)
    idx['k:'+s['key']].append(i)  # same key => same work (checked manually)
for ids in idx.values():
    for j in ids[1:]: parent[find(j)]=find(ids[0])
groups=collections.defaultdict(list)
for i in range(len(srcs)): groups[find(i)].append(i)
out=[]; keymap=collections.defaultdict(dict); used=set()
for g in sorted(groups.values(),key=lambda g:g[0]):
    mem=[srcs[i] for i in g]
    base=dict(mem[0])
    ck=base['key']
    if ck in used: ck=ck+'_'+base['_agent']
    used.add(ck)
    # prefer arxiv/paper url as main url, keep alternates
    urls=[]
    for m in mem:
        u=m.get('url')
        if u and u not in urls: urls.append(u)
    paper=[u for u in urls if arxiv(u) or 'thecvf' in u or 'doi' in u]
    base['url']=(paper or urls or [None])[0]
    alt=[u for u in urls if u!=base['url']]
    if alt: base['alt_urls']=alt
    for k in ('code','license'):
        if not base.get(k):
            for m in mem:
                if m.get(k): base[k]=m[k]; break
    base['verified']=any(m.get('verified') for m in mem)
    base['cited_by']=sorted({m['_agent'] for m in mem},key=ORDER.index)
    base['key']=ck
    base.pop('_agent',None)
    out.append(base)
    for m in mem: keymap[m['_agent']][m['key']]=ck
json.dump(out,open(R+'/sources.json','w'),indent=1,ensure_ascii=False)
json.dump(keymap,open(sys.argv[1] if len(sys.argv)>1 else R+'/../key_map.json','w'),indent=1)
print('sources',len(srcs),'-> merged',len(out))
multi=[o for o in out if len(o['cited_by'])>1]
print('shared across agents:',len(multi))
