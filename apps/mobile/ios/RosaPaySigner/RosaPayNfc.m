#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

// An event emitter rather than a plain module: a tap arrives whenever the
// customer makes it, so the payload is pushed the same way Android pushes it.
@interface RCT_EXTERN_MODULE (RosaPayNfc, RCTEventEmitter)

RCT_EXTERN_METHOD(getStatus : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(startBroadcast : (NSString *)payload resolver : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(stopBroadcast : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(startReading : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(stopReading : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)

@end
