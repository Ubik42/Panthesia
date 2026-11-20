"""Check the active goal's direction-review deadline; record only explicit agent reviews."""
import argparse,datetime,hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
STATE=ROOT/'docs/development/goal-state.json'
PROMPT=ROOT/'docs/development/current-goal.md'
LOG=ROOT/'docs/development/direction-reviews.jsonl'
def stamp(value):return value.astimezone(datetime.timezone.utc).isoformat(timespec='seconds').replace('+00:00','Z')
def parsed(value):return datetime.datetime.fromisoformat(value.replace('Z','+00:00')) if value else None

def main():
 parser=argparse.ArgumentParser(description=__doc__)
 group=parser.add_mutually_exclusive_group(required=True);group.add_argument('--status',action='store_true');group.add_argument('--record',choices=['aligned','adjusted'])
 summary=parser.add_mutually_exclusive_group();summary.add_argument('--summary');summary.add_argument('--summary-file');parser.add_argument('--evidence',action='append',default=[])
 args=parser.parse_args();state=json.loads(STATE.read_text(encoding='utf-8'));now=datetime.datetime.now(datetime.timezone.utc)
 prompt_hash=hashlib.sha256(PROMPT.read_bytes()).hexdigest();next_at=parsed(state.get('nextDirectionReviewAt'))
 if args.status:
  print(json.dumps({'currentBatch':state['currentBatch'],'now':stamp(now),'lastDirectionReviewAt':state.get('lastDirectionReviewAt'),'nextDirectionReviewAt':state.get('nextDirectionReviewAt'),'reviewDue':not next_at or now>=next_at or prompt_hash!=state.get('goalPromptSha256'),'promptChanged':prompt_hash!=state.get('goalPromptSha256'),'completedBatches':state.get('completedBatches',[])},ensure_ascii=False));return
 if args.summary_file:
  summary_path=(ROOT/args.summary_file).resolve()
  if not summary_path.is_relative_to(ROOT):parser.error('--summary-file must stay inside the repository')
  args.summary=summary_path.read_text(encoding='utf-8-sig').strip()
 if not args.summary or len(args.summary.strip())<8:parser.error('--record needs a meaningful --summary')
 if not args.evidence:parser.error('--record needs at least one --evidence repository path')
 for name in args.evidence:
  path=(ROOT/name).resolve()
  if not path.is_relative_to(ROOT) or not path.is_file():parser.error('Evidence must exist inside the repository: '+name)
 row={'at':stamp(now),'batch':state['currentBatch'],'result':args.record,'summary':args.summary,'evidence':args.evidence,'goalPromptUpdated':prompt_hash!=state.get('goalPromptSha256'),'previousPromptSha256':state.get('goalPromptSha256'),'goalPromptSha256':prompt_hash}
 with LOG.open('a',encoding='utf-8') as file:file.write(json.dumps(row,ensure_ascii=False)+'\n')
 state.update({'lastDirectionReviewAt':stamp(now),'nextDirectionReviewAt':stamp(now+datetime.timedelta(seconds=state['directionReviewIntervalSeconds'])),'goalPromptSha256':prompt_hash,'lastDirectionReviewResult':args.record})
 temp=STATE.with_suffix('.json.tmp');temp.write_text(json.dumps(state,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');temp.replace(STATE)
 print(json.dumps(row,ensure_ascii=False))
if __name__=='__main__':main()
