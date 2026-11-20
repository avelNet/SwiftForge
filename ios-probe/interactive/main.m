#include "../UIKitBridge.h"

typedef unsigned long NSUInteger;
typedef long NSInteger;
typedef NSUInteger UIControlEvents;
static const UIControlEvents touchUpInside = 1UL << 6;
static const UIControlEvents editingChanged = 1UL << 17;

@interface UIControl : UIView
- (void)addTarget:(id)target action:(SEL)action forControlEvents:(UIControlEvents)events;
@end

@interface UIButton : UIControl
+ (instancetype)buttonWithType:(NSInteger)buttonType;
- (void)setTitle:(NSString *)title forState:(NSUInteger)state;
@end

@interface UITextField : UIControl
- (void)setBorderStyle:(NSInteger)style;
- (void)setPlaceholder:(NSString *)placeholder;
- (void)setText:(NSString *)text;
- (NSString *)text;
- (void)setReturnKeyType:(NSInteger)type;
- (void)setDelegate:(id)delegate;
- (_Bool)resignFirstResponder;
@end

@interface UIView (SwiftForgeLayout)
- (void)setFrame:(CGRect)frame;
- (void)setAutoresizingMask:(NSUInteger)mask;
- (void)setAccessibilityIdentifier:(NSString *)identifier;
@end

@interface UIColor (SwiftForgeColors)
+ (instancetype)systemBackgroundColor;
+ (instancetype)labelColor;
@end

@interface NSString (SwiftForgeFormat)
+ (instancetype)stringWithFormat:(NSString *)format, ...;
@end

@interface NSUserDefaults : NSObject
+ (instancetype)standardUserDefaults;
- (NSInteger)integerForKey:(NSString *)key;
- (void)setInteger:(NSInteger)value forKey:(NSString *)key;
- (NSString *)stringForKey:(NSString *)key;
- (void)setObject:(id)value forKey:(NSString *)key;
@end

extern long long swiftforge_increment(long long count);

static NSString *text(const char *value) {
    return [NSString stringWithUTF8String:value];
}

@interface CounterDelegate : UIResponder
@property(nonatomic, strong) UIWindow *window;
@property(nonatomic, strong) UILabel *counterLabel;
@property(nonatomic, strong) NSUserDefaults *defaults;
@property(nonatomic) NSInteger count;
@end

@implementation CounterDelegate
- (void)updateLabel {
    [self.counterLabel setText:[NSString stringWithFormat:text("Count: %ld"), self.count]];
}

- (void)increment:(UIButton *)sender {
    self.count = swiftforge_increment(self.count);
    [self.defaults setInteger:self.count forKey:text("count")];
    [self updateLabel];
}

- (void)saveNote:(UITextField *)field {
    [self.defaults setObject:[field text] ?: text("") forKey:text("note")];
}

- (_Bool)textFieldShouldReturn:(UITextField *)field {
    return [field resignFirstResponder];
}

- (_Bool)application:(UIApplication *)application didFinishLaunchingWithOptions:(id)options {
    self.defaults = [NSUserDefaults standardUserDefaults];
    self.count = [self.defaults integerForKey:text("count")];

    CGRect screen = [[UIScreen mainScreen] bounds];
    self.window = [[UIWindow alloc] initWithFrame:screen];
    UIViewController *controller = [[UIViewController alloc] init];
    UIView *view = [controller view];
    [view setBackgroundColor:[UIColor systemBackgroundColor]];
    CGFloat width = screen.size.width - 40;

    self.counterLabel = [[UILabel alloc] initWithFrame:(CGRect){{20, 105}, {width, 44}}];
    [self.counterLabel setAutoresizingMask:1UL << 1];
    [self.counterLabel setTextColor:[UIColor labelColor]];
    [self.counterLabel setAccessibilityIdentifier:text("counter-value")];
    [self updateLabel];
    [view addSubview:self.counterLabel];

    UIButton *increment = [UIButton buttonWithType:1]; // UIButtonTypeSystem
    [increment setFrame:(CGRect){{20, 149}, {110, 44}}];
    [increment setTitle:text("Increment") forState:0];
    [increment setAccessibilityIdentifier:text("increment")];
    [increment addTarget:self action:@selector(increment:) forControlEvents:touchUpInside];
    [view addSubview:increment];

    UITextField *note = [[UITextField alloc] initWithFrame:(CGRect){{20, 206}, {width, 44}}];
    [note setAutoresizingMask:1UL << 1];
    [note setBorderStyle:3]; // UITextBorderStyleRoundedRect
    [note setPlaceholder:text("Enter a note")];
    [note setText:[self.defaults stringForKey:text("note")] ?: text("")];
    [note setReturnKeyType:9]; // UIReturnKeyDone
    [note setAccessibilityIdentifier:text("note")];
    [note setDelegate:self];
    [note addTarget:self action:@selector(saveNote:) forControlEvents:editingChanged];
    [view addSubview:note];

    [self.window setRootViewController:controller];
    [self.window makeKeyAndVisible];
    return 1;
}
@end

int main(int argc, char **argv) {
    @autoreleasepool {
        return UIApplicationMain(argc, argv, (id)0, NSStringFromClass([CounterDelegate class]));
    }
}
