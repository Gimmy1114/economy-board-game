// Revision ordering is shared by every tab; page navigation stays local to each tab.
export function syncInfo(game){
  if(!game)return null;
  return game.sync||{
    gameId:`legacy:${game.seed}:${game.players?.map(p=>p.name).join('|')}`,
    revision:0,
    updatedAt:0,
    writerId:''
  };
}

export function isNewerGame(incoming,current){
  if(!incoming)return false;
  if(!current)return true;
  const a=syncInfo(incoming),b=syncInfo(current);
  if(a.gameId===b.gameId){
    if(a.revision!==b.revision)return a.revision>b.revision;
    if(a.updatedAt!==b.updatedAt)return a.updatedAt>b.updatedAt;
    return a.writerId>b.writerId;
  }
  if(a.updatedAt!==b.updatedAt)return a.updatedAt>b.updatedAt;
  return a.gameId>b.gameId;
}
