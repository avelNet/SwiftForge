#include "UIKitBridge.h"

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
