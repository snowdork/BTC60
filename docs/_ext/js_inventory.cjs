/** @module js_inventory
 * Extract browser procedure documentation without executing application code.
 */
const fs=require('fs'),acorn=require('acorn');
const file=process.argv[2],source=fs.readFileSync(file,'utf8'),comments=[];
const tree=acorn.parse(source,{ecmaVersion:'latest',locations:true,onComment:comments});
const functions=[];
/** Traverse the AST and collect named callables, their JSDoc, and control-flow locations. */
function visit(node,parent){
 if(!node||typeof node!=='object')return;
 if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node.type)){
  const name=node.id?.name||(parent?.type==='VariableDeclarator'?parent.id.name:parent?.type==='AssignmentExpression'?source.slice(parent.left.start,parent.left.end):null);
  if(name){
   const anchor=parent?.type==='VariableDeclarator'?parent.start:node.start;
   const comment=comments.filter(c=>c.end<=anchor&&c.value.trim().startsWith('*')).at(-1);
   const doc=comment&&source.slice(comment.end,anchor).trim()===''?comment.value.replace(/^\*/, '').trim():'';
   const flow=[];
   /** Record this callable's branches and loops without crossing into nested functions. */
   function controls(n){
    if(!n||typeof n!=='object')return;
    if(n!==node&&['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(n.type))return;
    if(['IfStatement','ForStatement','ForOfStatement','ForInStatement','WhileStatement','DoWhileStatement','SwitchStatement'].includes(n.type)){
     flow.push({line:n.loc.start.line,kind:n.type.replace('Statement',''),expression:n.test?source.slice(n.test.start,n.test.end):n.discriminant?source.slice(n.discriminant.start,n.discriminant.end):source.slice(n.start,n.body?.start||n.end).trim().replace(/\n/g,' ')});
    }
    for(const value of Object.values(n))if(Array.isArray(value))value.forEach(controls);else if(value&&typeof value==='object')controls(value);
   }
   controls(node);
   functions.push({name,params:node.params.map(p=>source.slice(p.start,p.end)).join(', '),line:node.loc.start.line,doc,flow});
  }
 }
 for(const value of Object.values(node))if(Array.isArray(value))value.forEach(n=>visit(n,node));else if(value&&typeof value==='object')visit(value,node);
}
visit(tree,null);
console.log(JSON.stringify({module:comments.find(c=>c.value.includes('@module'))?.value.replace(/^\*\s*@module[^\n]*\n/,'').replace(/^\s*\* ?/gm,'').trim()||'',functions}));
