import test from "node:test";
import assert from "node:assert/strict";
import {validateClinicSetup} from "../src/clinic-setup.ts";
import type {UUID} from "@clinic-os/domain";
const id="10000000-0000-4000-8000-000000000101" as UUID;
test("configuration preserves explicit versions and rejects cross-section or malformed data",()=>{
 assert.deepEqual(validateClinicSetup("chair",{configuration:{code:"room-1",displayName:" Room 1 ",active:true}}),{code:"room-1",displayName:"Room 1",active:true});
 for(const input of [{recordId:id,configuration:{code:"chair",displayName:"Chair",active:true}},{expectedVersion:1,configuration:{code:"chair",displayName:"Chair",active:true}},{configuration:{code:"chair",displayName:"Chair",active:true,providerUserId:id}}])assert.throws(()=>validateClinicSetup("chair",input),RangeError);
 assert.throws(()=>validateClinicSetup("clinic",{recordId:id,expectedVersion:1,configuration:{displayName:"Test",timezone:"invalid/timezone"}}),RangeError);
});
test("working hours reject overnight, reversed and impossible date ranges",()=>{
 const configuration={providerUserId:id,dayOfWeek:1,startsAt:"09:00",endsAt:"18:00",effectiveFrom:"2026-09-26",effectiveUntil:null,active:true};
 assert.doesNotThrow(()=>validateClinicSetup("provider_schedule",{configuration}));
 for(const override of [{endsAt:"08:00"},{effectiveFrom:"2026-02-30"},{effectiveUntil:"2026-01-01"},{dayOfWeek:7},{startsAt:"29:00"}])assert.throws(()=>validateClinicSetup("provider_schedule",{configuration:{...configuration,...override}}),RangeError);
});
test("pricebook requires exact integer paise and tax basis points",()=>{
 const configuration={code:"safe-price",displayName:"Synthetic",category:"test",defaultUnitPriceMinor:100000,currency:"INR",taxRateBasisPoints:0,status:"active"};
 assert.doesNotThrow(()=>validateClinicSetup("pricebook",{configuration}));
 for(const override of [{defaultUnitPriceMinor:1.5},{defaultUnitPriceMinor:-1},{taxRateBasisPoints:10001},{currency:"USD"}])assert.throws(()=>validateClinicSetup("pricebook",{configuration:{...configuration,...override}}),RangeError);
});
