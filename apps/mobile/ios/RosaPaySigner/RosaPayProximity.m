#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

// An event emitter, like the NFC module: a merchant comes into range whenever
// the customer walks up, so the request is pushed rather than polled for.
@interface RCT_EXTERN_MODULE (RosaPayProximity, RCTEventEmitter)

RCT_EXTERN_METHOD(getStatus : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(requestPermissions : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(startBroadcast : (NSString *)payload resolver : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(stopBroadcast : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(startScanning : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(stopScanning : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)

@end
