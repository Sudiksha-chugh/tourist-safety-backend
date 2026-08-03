import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("DigitalIdRegistryModule", (m) => {
  const registry = m.contract("DigitalIdRegistry");
  return { registry };
});