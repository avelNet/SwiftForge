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
extern int swiftforge_probe_value(int input);

@interface ProbeDelegate : UIResponder
@property(nonatomic, strong) UIWindow *window;
@end

@implementation ProbeDelegate
- (_Bool)application:(UIApplication *)application didFinishLaunchingWithOptions:(id)options {
    self.window = [[UIWindow alloc] initWithFrame:[[UIScreen mainScreen] bounds]];
    UIViewController *controller = [[UIViewController alloc] init];
    [[controller view] setBackgroundColor:[UIColor whiteColor]];
    UILabel *label = [[UILabel alloc] initWithFrame:(CGRect){{20, 100}, {350, 65}}];
    const char *message = swiftforge_probe_value(41) == 42
        ? "SwiftForge: Swift on iPhone OK"
        : "SwiftForge: Swift probe failed";
    [label setText:[NSString stringWithUTF8String:message]];
    [label setTextColor:[UIColor blackColor]];
    [[controller view] addSubview:label];
    [self.window setRootViewController:controller];
    [self.window makeKeyAndVisible];
    return 1;
}
@end

int main(int argc, char **argv) {
    @autoreleasepool {
        return UIApplicationMain(argc, argv, (id)0, NSStringFromClass([ProbeDelegate class]));
    }
}
