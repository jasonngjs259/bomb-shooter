// Metro asset modules (metro.config.js adds glb): a module id for expo-asset.
declare module "*.glb" {
  const asset: number;
  export default asset;
}
