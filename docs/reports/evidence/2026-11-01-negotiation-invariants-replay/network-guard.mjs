import {writeFileSync} from 'node:fs';
let blockedCalls=0;
globalThis.fetch=async()=>{blockedCalls++;throw new Error('NETWORK_FORBIDDEN_OFFLINE_REPLAY');};
process.on('exit',()=>writeFileSync('/Users/tmaneyro22/Documents/AGENTE IA/tmp/invariant-network-proof.json',JSON.stringify({fetch_disabled:true,blocked_fetch_attempts:blockedCalls},null,2)+'\n'));
