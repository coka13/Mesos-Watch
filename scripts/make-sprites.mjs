// Original pixel-art decorations for the site (not game assets): each sprite is an ASCII grid turned into a crisp SVG.
//   node scripts/make-sprites.mjs   → dist/sprites/*.svg
import fs from 'node:fs';
const PALETTE={
 k:'#3a2312',w:'#ffffff',o:'#f28c28',O:'#c9611a',y:'#ffe9b8',Y:'#e9c98c',g:'#7cc95a',G:'#3f8f3a',b:'#5fa8e8',B:'#2f6fae',
 r:'#e2483d',R:'#a92d26',p:'#ffb6c8',P:'#e58aa3',s:'#c9d6e3',S:'#8fa3b8',h:'#6b3a1a',t:'#3d6fd1',T:'#26468c',f:'#ffd7ae',n:'#5b5b6b',e:'#9bd1ff'};
const SPRITES={
 mushroom:`
....kkkkkk....
..kkoooowokk..
.koowwoooooOk.
kooowwooowooOk
koooooooowwoOk
kOooowoooooOOk
.kOOOOOOOOOOk.
..kkyyyyyykk..
...kykyykyk...
...kyyyyyyk...
...kyYyyYyk...
..kkyyyyyykk..
..kYYk..kYYk..
..kkkk..kkkk..`,
 slime:`
......kk......
.....kgGk.....
....kgggk.....
..kkggggggkk..
.kgwwgggggggk.
kgwwggggggggGk
kgggkggggkggGk
kgggkggggkggGk
kggggggggggGGk
.kGggGGGGgGGk.
..kkkkkkkkkk..`,
 snail:`
.....kkkkk....
....kbbbbbk...
...kbBBBBbbk..
..kbBbbbbBbk..
..kbBbBBbBbk..
..kbBbbBBbbk..
k.kbbBBBbbk...
kk.kkbbbbk....
kykkkkkkkkkk..
kyykyyyyyyyyk.
.kyyyyyyyyyyk.
..kkkkkkkkkk..`,
 pig:`
...kk....kk....
..kRrk..kRrk...
.kkkkkkkkkkkk..
.kppppppppppPk.
kppkpppppkpppPk
kpppppppppppppk
kppppPPPpppppPk
kpppPkPkPppppPk
.kpppPPPpppppk.
..kPPPPPPPPPk..
..kpk.kpk.kpk..
..kkk.kkk.kkk..`,
 yeti:`
....kkkkkk....
...kssssssk...
..kswwwwwwsk..
..kswkwwkwsk..
.ksswwwwwwssk.
ksssswbbwsssSk
ksSssswwssssSk
ksSssssssssSSk
.kSssssssssSk.
..kSSssssSSk..
..kssk..kssk..
..kkkk..kkkk..`,
 adventurer:`
...kkkkkk...
..khhhhhhk..
.khhhhhhhhk.
.khffffffhk.
.kffkffkffk.
.kffffffffk.
..kffffffk..
.kttttttttk.
kfkttTTttkfk
kfkttttttkfk
.kkTTTTTTkk.
..kTTkkTTk..
..kTTk.kTTk.
..kkkk.kkkk.`,
};
fs.mkdirSync('dist/sprites',{recursive:true});
for(const [name,art]of Object.entries(SPRITES)){
 const rows=art.trim().split('\n').map(r=>r.trimEnd());
 const w=Math.max(...rows.map(r=>r.length)),h=rows.length,byColor={};
 rows.forEach((row,y)=>{let x=0;while(x<row.length){const c=row[x];if(c==='.'||!PALETTE[c]){x++;continue;}let run=1;while(row[x+run]===c)run++;(byColor[c]??=[]).push(`M${x} ${y}h${run}v1h-${run}z`);x+=run;}});
 const paths=Object.entries(byColor).map(([c,d])=>`<path fill="${PALETTE[c]}" d="${d.join('')}"/>`).join('');
 fs.writeFileSync(`dist/sprites/${name}.svg`,`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w*4}" height="${h*4}" shape-rendering="crispEdges">${paths}</svg>\n`);
 console.log(name,w+'x'+h);
}
