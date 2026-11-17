const fs=require('node:fs'),path=require('node:path');
require('../tipsy-exporter/core.js');require('../tipsy-exporter/png.js');require('../tipsy-exporter/bot-model.js');require('../tipsy-exporter/bot-package.js');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'tipsy-exporter');
function extensionFiles(){
  return fs.readdirSync(dir).filter(n=>fs.statSync(path.join(dir,n)).isFile()).sort()
    .map(n=>({path:'exporter/'+n,data:new Uint8Array(fs.readFileSync(path.join(dir,n)))}));
}
function main(){
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
  fs.mkdirSync(path.join(root,'dist'),{recursive:true});
  const target=path.join(root,'dist',`RoleLeaf-${manifest.version}.zip`);
  fs.writeFileSync(target,BotPackage.zip(extensionFiles()));
  console.log(target);
}
module.exports={extensionFiles};
if(require.main===module)main();
