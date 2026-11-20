@_cdecl("swiftforge_increment")
public func swiftForgeIncrement(_ count: Int64) -> Int64 {
    count == Int64.max ? count : count + 1
}
