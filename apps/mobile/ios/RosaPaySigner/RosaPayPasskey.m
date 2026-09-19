#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE (RosaPayPasskey, NSObject)

RCT_EXTERN_METHOD(isSupported : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(createCredential : (NSDictionary *)request resolver : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(assert : (NSDictionary *)request resolver : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)

@end
