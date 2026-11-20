#pragma once

// Minimal declarations for the system classes messaged by this probe.
// No Apple headers or SDK files are used in this experiment.
typedef double CGFloat;
typedef struct { CGFloat x, y; } CGPoint;
typedef struct { CGFloat width, height; } CGSize;
typedef struct { CGPoint origin; CGSize size; } CGRect;

@class NSString, UIApplication, UIColor, UIView;

__attribute__((objc_root_class))
@interface NSObject
+ (Class)class;
+ (instancetype)alloc;
- (instancetype)init;
@end

@interface UIResponder : NSObject
@end

@interface UIView : UIResponder
- (instancetype)initWithFrame:(CGRect)frame;
- (void)setBackgroundColor:(UIColor *)color;
- (void)addSubview:(UIView *)view;
@end

@interface UILabel : UIView
- (void)setText:(NSString *)text;
- (void)setTextColor:(UIColor *)color;
@end

@interface UIViewController : UIResponder
- (UIView *)view;
@end

@interface UIWindow : UIView
- (void)setRootViewController:(UIViewController *)controller;
- (void)makeKeyAndVisible;
@end

@interface UIScreen : UIResponder
+ (instancetype)mainScreen;
- (CGRect)bounds;
@end

@interface UIColor : UIResponder
+ (instancetype)whiteColor;
+ (instancetype)blackColor;
@end

@interface NSString : UIResponder
+ (instancetype)stringWithUTF8String:(const char *)text;
@end

extern NSString *NSStringFromClass(Class type);
extern int UIApplicationMain(int argc, char **argv, NSString *principal, NSString *delegate);
