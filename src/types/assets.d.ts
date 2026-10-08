// Metro asset modules (metro.config.js adds glb): a module id for expo-asset.
declare module "*.glb" {
  const asset: number;
  export default asset;
}

// Audio files (Metro's default asset extensions include mp3).
declare module "*.mp3" {
  const asset: number;
  export default asset;
}
