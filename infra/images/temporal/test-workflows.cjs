// CI-only fixture. Never included in the product image or registered by ClinicOS.
const { proxyActivities, sleep } = require("@temporalio/workflow");
const { confirmSyntheticValue } = proxyActivities({ startToCloseTimeout: "10 seconds" });
exports.securityImageSmoke = async function securityImageSmoke(value) {
  const confirmed = await confirmSyntheticValue(value);
  await sleep("10 milliseconds");
  return confirmed;
};
