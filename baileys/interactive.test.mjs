import test from 'node:test';
import assert from 'node:assert/strict';
import {selectionText,listContent,listRelayOptions,buttonsContent,buttonsRelayOptions,documentFilename} from './interactive.mjs';
test('native, classic list and quick reply selections preserve stable IDs',()=>{
 const id='scv:report:1234567890abcdef:5';
 assert.equal(selectionText({listResponseMessage:{singleSelectReply:{selectedRowId:id}}}),id);
 assert.equal(selectionText({interactiveResponseMessage:{nativeFlowResponseMessage:{paramsJson:JSON.stringify({id})}}}),id);
 assert.equal(selectionText({buttonsResponseMessage:{selectedButtonId:id}}),id);
 assert.equal(selectionText({interactiveResponseMessage:{nativeFlowResponseMessage:{paramsJson:'bad'}}}),'');
});
test('list payload has native select type and bounded rows',()=>{
 const data={title:'Relatórios',content:'Escolha',button:'Ver relatórios',sections:[{title:'Disponíveis',rows:[{rowId:'scv:report:1234567890abcdef:5',title:'Relatório',description:'Documento autorizado'}]}]};
 assert.equal(listContent(data).listMessage.listType,1);
 assert.throws(()=>listContent({...data,sections:[{title:'x',rows:Array(11).fill(data.sections[0].rows[0])}]}));
 assert.throws(()=>listContent({...data,button:'x'.repeat(21)}));
});

test('native lists include business list rendering metadata and retain message identity',()=>{
 const options=listRelayOptions('fake-test-id');
 assert.equal(options.messageId,'fake-test-id');
 assert.deepEqual(options.additionalNodes,[{tag:'biz',attrs:{},content:[{tag:'list',attrs:{type:'product_list',v:'2'}}]}]);
});

test('post report actions use quick reply buttons with no numbered menu',()=>{
 const id='12345678-1234-1234-1234-123456789abc';
 const data={content:'Relatório enviado.',buttons:[{id:`scv:again:${id}`,title:'Solicitar novamente'},{id:`scv:new:${id}`,title:'Novo relatório'}]};
 const native=buttonsContent(data).viewOnceMessage.message.interactiveMessage.nativeFlowMessage;
 assert.equal(native.buttons.length,2);assert.equal(native.buttons[0].name,'quick_reply');
 assert.equal(JSON.parse(native.buttons[1].buttonParamsJson).id,`scv:new:${id}`);
 assert.equal(buttonsRelayOptions('message-id').additionalNodes[0].content[0].attrs.type,'native_flow');
 assert.throws(()=>buttonsContent({...data,buttons:[]}));
});

test('date prompts use native Hoje and Ontem reply buttons with scoped IDs',()=>{
 const data={content:'Informe a data em DD/MM/AAAA.',buttons:[{id:'scv:date:1234567890abcdef:today',title:'Hoje'},{id:'scv:date:1234567890abcdef:yesterday',title:'Ontem'}]};
 const buttons=buttonsContent(data).viewOnceMessage.message.interactiveMessage.nativeFlowMessage.buttons;
 assert.equal(JSON.parse(buttons[0].buttonParamsJson).display_text,'Hoje');
 assert.equal(selectionText({interactiveResponseMessage:{nativeFlowResponseMessage:{paramsJson:JSON.stringify({id:data.buttons[1].id})}}}),data.buttons[1].id);
 assert.throws(()=>buttonsContent({...data,buttons:[{id:'scv:date:1234567890abcdef:tomorrow',title:'Hoje'},data.buttons[1]]}));
});

test('return to menu is accepted alone or alongside the date shortcuts',()=>{
 const menu={id:'scv:menu',title:'Retornar ao menu'};
 assert.equal(buttonsContent({content:'Relatório indisponível.',buttons:[menu]}).viewOnceMessage.message.interactiveMessage.nativeFlowMessage.buttons.length,1);
 const dates=[{id:'scv:date:1234567890abcdef:today',title:'Hoje'},{id:'scv:date:1234567890abcdef:yesterday',title:'Ontem'},menu];
 assert.equal(buttonsContent({content:'Data',buttons:dates}).viewOnceMessage.message.interactiveMessage.nativeFlowMessage.buttons.length,3);
 assert.throws(()=>buttonsContent({content:'x',buttons:[...dates,menu]}));
});

test('document filename keeps the report title, spaces and accents',()=>{
 assert.equal(documentFilename('Indicadores Médicos.pdf'),'Indicadores Médicos.pdf');
 assert.equal(documentFilename('../pasta/arquivo.pdf'),'.. pasta arquivo.pdf');
 assert.equal(documentFilename(undefined),'relatorio.pdf');
});
