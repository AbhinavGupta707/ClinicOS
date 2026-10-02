import test from "node:test";
import assert from "node:assert/strict";
import {validateIntakeResponses,validateIntakeTemplateSchema} from "../src/intake-validation.ts";
const schema={type:"object",additionalProperties:false,properties:{allergies:{type:"string",enum:["reported","none"]},consented:{type:"boolean"},count:{type:"integer",minimum:0,maximum:10}},required:["allergies","consented","count"]};
test("intake validation preserves explicit false and zero and rejects missing or invented answers",()=>{
 assert.doesNotThrow(()=>validateIntakeResponses(schema,{allergies:"none",consented:false,count:0}));
 for(const response of [{allergies:"none",count:0},{allergies:"none",consented:false,count:0,invented:true},{allergies:"unknown",consented:true,count:1},{allergies:"none",consented:true,count:1.5},{allergies:"none",consented:"true",count:1}])assert.throws(()=>validateIntakeResponses(schema,response),RangeError);
});
test("unsupported template constraints and unsafe field names fail closed",()=>{
 for(const template of [{properties:{note:{type:"string",pattern:".*"}}},{properties:{note:{type:"array"}}},{properties:{constructor:{type:"string"}}},{fields:["note","note"]},{properties:{note:{type:"string"}},additionalProperties:true}])assert.throws(()=>validateIntakeTemplateSchema(template),RangeError);
 assert.doesNotThrow(()=>validateIntakeResponses({fields:["allergies"]},{allergies:"Synthetic documented response"}));
});
