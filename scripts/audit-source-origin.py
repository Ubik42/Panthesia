"""Read-only source provenance inventory. A missing upstream path is not proof of originality."""
import argparse, collections, hashlib, json, subprocess
from pathlib import Path

def git(root,*args):
 return subprocess.run(['git','-C',str(root),*args],check=True,capture_output=True).stdout

def audit(root, upstream, ref):
 names=git(root,'ls-files','-z').decode().split('\0')
 old_names=set(git(upstream,'ls-tree','-r','--name-only',ref).decode().splitlines())
 eligible={'.rs','.toml','.ts','.tsx','.js','.mjs','.json','.yml','.yaml','.css','.ps1','.cmd','.sh','.plist','.md','.svg'}
 records=[]
 for name in filter(None,names):
  path=root/name
  if path.suffix not in eligible or not path.is_file():continue
  original=name.replace('panthesia','neothesia').replace('Panthesia','Neothesia')
  if original not in old_names:original=name if name in old_names else None
  current=path.read_bytes().replace(b'\r\n',b'\n')
  record={'path':name,'lines':len(current.splitlines()),'sha256':hashlib.sha256(current).hexdigest(),'upstreamPath':original,'status':'no-path-match'}
  if original:
   old=git(upstream,'show',f'{ref}:{original}').replace(b'\r\n',b'\n')
   record['upstreamSha256']=hashlib.sha256(old).hexdigest()
   branded=old.replace(b'neothesia',b'panthesia').replace(b'Neothesia',b'Panthesia')
   record['status']='upstream-exact' if current==old else 'branding-only' if current==branded else 'upstream-modified'
  records.append(record)
 return {'schemaVersion':1,'repositoryRevision':git(root,'rev-parse','HEAD').decode().strip(),'upstreamRevision':git(upstream,'rev-parse',ref).decode().strip(),'upstreamRef':ref,'method':'Tracked text files, normalized CRLF, path mapping and exact/branding byte comparison; modified and no-path-match require human provenance review. Dependencies and binary assets require separate inventory. No licensing conclusion is inferred from counts.','counts':dict(collections.Counter(r['status'] for r in records)),'files':records}

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--upstream',required=True);p.add_argument('--ref',default='upstream/master');p.add_argument('--output',required=True);args=p.parse_args()
 result=audit(Path(__file__).resolve().parents[1],Path(args.upstream),args.ref)
 Path(args.output).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print(json.dumps({k:v for k,v in result.items() if k!='files'},ensure_ascii=False))
