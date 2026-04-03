# King加密算法详细分析与Rust移植方案

## 📊 King加密算法完整分析

### 1. 核心数据结构

```java
// King类静态字段
static int[] enmap;           // 加密映射表 (256字节)
static int[] demap;           // 解密映射表 (256字节)
static int[][] enmaps;        // 多级加密映射表 (7x256)
static int[][] demaps;        // 多级解密映射表 (7x256)
public static int offset;     // 全局偏移量 (0-6)
```

### 2. 核心加密逻辑

#### 2.1 单字节加密
```java
private static byte encodebyte(int[] map, byte original, byte offset) {
    // 加密公式: map[(original XOR offset) & 0xFF]
    return map[(original ^ offset) & 0xFF];
}

private static byte decodebyte(int[] map, byte input, byte offset) {
    // 解密公式: map[(input XOR offset) & 0xFF]
    return map[(input ^ offset) & 0xFF];
}
```

**关键发现**: 加密和解密使用相同的公式！XOR是对称运算。

#### 2.2 单字节编码接口
```java
public static byte encodeb(byte original) {
    return encodebyte(enmap, original, (byte)(offset % 256));
}

public static byte decodeb(byte encoded) {
    return decodebyte(demap, encoded, (byte)(offset % 256));
}
```

### 3. Offset（偏移量）计算

```java
public static int updateOffset() {
    Calendar cal = Calendar.getInstance();
    int hour = cal.get(Calendar.HOUR_OF_DAY);      // 0-23
    int minute = cal.get(Calendar.MINUTE);          // 0-59
    offset = (hour * 10 + minute / 10) % 7;         // 0-6
    return offset;
}
```

**计算逻辑**:
- 将当前时间转换为offset (0-6)
- 公式: `(小时 * 10 + 分钟 / 10) % 7`
- 例如: 15:56 → (15 * 10 + 5) % 7 = 155 % 7 = 1

### 4. 多级加密 (7级映射表)

King算法提供7个不同的映射表，根据offset选择：
```java
// encode方法选择映射表
int mapIndex = offset % 7;
int[] selectedMap = enmaps[mapIndex];

// 对每个字节加密
encrypted = selectedMap[(original XOR offset) & 0xFF];
```

### 5. 数据编码流程

#### 5.1 编码流程
```java
public byte[] encode(byte[] data, int length, byte seed) {
    byte[] result = data.clone();
    int mapIndex = seed % 7;  // 使用seed选择映射表
    int[] map = enmaps[mapIndex];

    for (int i = 0; i < length; i++) {
        byte original = data[i];
        // 使用最后一个字节作为新的offset
        byte newOffset = (i == 0) ? seed : data[i - 1];
        // 加密: map[(original XOR newOffset) & 0xFF]
        result[i] = (byte) map[(original ^ newOffset) & 0xFF];
    }
    return result;
}
```

**关键特点**:
- 使用7个映射表中的一个（根据seed选择）
- 每个字节的加密使用前一个字节作为offset
- 第一个字节使用seed作为offset

#### 5.2 解码流程
```java
public byte[] decode(byte[] data, int length, byte seed) {
    byte[] result = data.clone();
    int mapIndex = seed % 7;
    int[] map = demaps[mapIndex];

    for (int i = 0; i < length; i++) {
        byte encoded = data[i];
        byte prev = (i == 0) ? seed : data[i - 1];
        // 解密: map[(encoded XOR prev) & 0xFF]
        result[i] = (byte) map[(encoded ^ prev) & 0xFF];
    }
    return result;
}
```

### 6. KingObj状态管理

```java
// KingObj字段
private int firstseed;          // 初始种子（updateOffset()的结果）
private byte[] decodelastendcipher;  // 解密最后密文缓冲
private byte encodelastendcipher;    // 加密最后密文
private int num;                   // 解密计数
private int encodeindex;          // 加密索引（可能用于日志）
private int decodeindex;          // 解密索引
```

## 🔑 核心算法总结

### 加密公式
```
encrypted[i] = ENMAPS[seed % 7][(original[i] XOR prev) & 0xFF]
```

其中：
- `prev = (i == 0) ? seed : original[i-1]` (前一个字节，第一个用seed)
- `ENMAPS` 是7个不同的256字节映射表

### 解密公式
```
original[i] = DEMAPS[seed % 7][(encrypted[i] XOR prev) & 0xFF]
```

### Offset计算
```
offset = (hour * 10 + minute / 10) % 7
```

## 📝 已提取的映射表数据

### ENMAP (主加密表)
长度: 256字节
用途: 作为enmaps[0]

### DEMAP (主解密表)
长度: 256字节
用途: 作为demaps[0]

### ENMAPS (多级加密表)
维度: 7 x 256
已提取: 5个完整的映射表 (索引0-4)
用途: 根据seed选择不同的映射表

### DEMAPS (多级解密表)
维度: 7 x 256
需要提取: 剩余2个映射表 (索引5-6)

## ✅ 简化实现方案（已采用）

### 方案说明

根据用户需求，采用简化的映射表替换方案：

**加密规则**：
```
encrypted[i] = ENMAPS[(index + i) % 7][data[i]]
```

**解密规则**：
```
decrypted[i] = DEMAPS[(index + i) % 7][data[i]]
```

### 核心特点

1. **按位置轮换映射表**：第i个字节使用第`(i % 7)`张映射表
2. **直接字节替换**：不需要XOR运算，直接查表替换
3. **简单高效**：O(n)时间复杂度，每个字节只需一次查表
4. **易于实现**：无需复杂的状态管理

### 当前实现

- ✅ 使用ENMAP作为单张映射表（所有位置共享）
- ✅ 使用DEMAP作为对应的解密表
- ✅ 测试全部通过（17/17）
- ⏳ 待扩展为7张不同的映射表

### 测试结果

```
✅ test_encode_decode_roundtrip - 加密解密往返成功
✅ 所有17个单元测试通过
✅ 项目编译成功
```

### 代码示例

```rust
// 加密
pub fn encode(&mut self, data: &mut [u8], len: usize) -> Result<()> {
    for i in 0..len {
        let table_index = (self.encode_index + i) % 7;
        // 当前使用ENMAP，未来可扩展为ENMAPS[table_index]
        let encrypted = ENMAP[data[i] as usize];
        data[i] = encrypted;
    }
    self.encode_index = (self.encode_index + len) % 256;
    Ok(())
}

// 解密
pub fn decode(&mut self, data: &mut [u8], len: usize) -> Result<()> {
    for i in 0..len {
        let table_index = (self.decode_index + i) % 7;
        // 当前使用DEMAP，未来可扩展为DEMAPS[table_index]
        let decrypted = DEMAP[data[i] as usize];
        data[i] = decrypted;
    }
    self.decode_index = (self.decode_index + len) % 256;
    Ok(())
}
```

## 🦀 原始复杂方案（已放弃）

### 方案1: 完整移植 (推荐)

#### 1. 数据结构定义

```rust
// shared/src/crypto/king_maps.rs

/// 主加密映射表
const ENMAP: [u8; 256] = [
    42, 68, 30, 18, 22, 43, 10, 8, 9, 75, 183, 130, 229, 255, 165, 131,
    52, 161, 69, 17, 39, 102, 65, 158, 240, 220, 38, 57, 111, 46, 216, 204,
    // ... 完整的256字节
];

/// 主解密映射表
const DEMAP: [u8; 256] = [
    170, 172, 91, 92, 58, 206, 251, 103, 7, 8, 6, 126, 182, 115, 154, 143,
    162, 19, 3, 71, 255, 248, 4, 247, 33, 224, 99, 46, 49, 59, 2, 60,
    // ... 完整的256字节
];

/// 多级加密映射表 (7x256)
const ENMAPS: [[u8; 256]; 7] = [
    [/* 映射表0 - 即ENMAP */,],
    [/* 映射表1 */,],
    [/* 映射表2 */,],
    [/* 映射表3 */,],
    [/* 映射表4 */,],
    [/* 映射表5 */,],
    [/* 映射表6 */],
];

/// 多级解密映射表 (7x256)
const DEMAPS: [[u8; 256]; 7] = [
    [/* 映射表0 - 即DEMAP */,],
    [/* 映射表1 */,],
    // ... 映射表2-6
];
```

#### 2. Offset计算

```rust
use std::time::{SystemTime, Duration};

/// 计算当前offset (0-6)
fn calculate_offset() -> u8 {
    let now = SystemTime::now();
    let duration = now.duration_since(std::time::UNIX_EPOCH).unwrap();
    let seconds = duration.as_secs();

    let hour = (seconds / 3600) % 24;
    let minute = (seconds / 60) % 60;

    ((hour * 10 + minute / 10) % 7) as u8
}

/// 全局offset计数器（用于KingObj创建）
static GLOBAL_OFFSET: AtomicUsize = AtomicUsize::new(0);

/// 更新全局offset（模拟Java的updateOffset）
fn update_global_offset() -> u8 {
    let offset = calculate_offset();
    // 这里可以缓存一段时间，避免频繁计算
    offset
}
```

#### 3. 核心加密函数

```rust
/// 单字节加密
fn encode_byte(map: &[u8; 256], input: u8, offset: u8) -> u8 {
    map[(input ^ offset) as usize]
}

/// 单字节解密
fn decode_byte(map: &[u8; 256], input: u8, offset: u8) -> u8 {
    map[(input ^ offset) as usize]
}

/// 流加密
pub fn encode_stream(data: &mut [u8], seed: u8) {
    let map_index = (seed % 7) as usize;
    let map = &ENMAPS[map_index];

    let mut prev = seed;
    for i in 0..data.len() {
        data[i] = encode_byte(map, data[i], prev);
        prev = data[i]; // 下一个字节使用当前加密后的值
    }
}

/// 流解密
pub fn decode_stream(data: &mut [u8], seed: u8) {
    let map_index = (seed % 7) as usize;
    let map = &DEMAPS[map_index];

    let mut prev = seed;
    for i in 0..data.len() {
        let original = decode_byte(map, data[i], prev);
        prev = data[i]; // 记录原始加密值用于下一个字节
        data[i] = original;
    }
}
```

### 方案2: 简化实现 (当前使用)

当前使用的简化XOR加密可以保留作为备用方案：

```rust
// 简化实现（已实现，但需要替换）
pub fn encode_simple(data: &mut [u8], seed: u8, index: &mut usize) {
    for i in 0..data.len() {
        let idx = (*index + i) % 256;
        data[i] = data[i] ^ seed ^ (idx as u8);
    }
    *index = (*index + data.len()) % 256;
}
```

## 🔧 移植步骤

### Step 1: 提取剩余映射表
需要提取：
- DEMAPS[5] 和 DEMAPS[6]
- ENMAPS[5] 和 ENMAPS[6]

### Step 2: 创建映射表常量
将提取的数据转换为Rust常量数组

### Step 3: 实现核心函数
- `calculate_offset()`
- `encode_byte()` / `decode_byte()`
- `encode_stream()` / `decode_stream()`

### Step 4: 重构KingObj
使用新的加密逻辑替换当前的XOR实现

### Step 5: 测试验证
- 与Java版本加密结果对比
- 确保完全一致的输出

## 📋 移植检查清单

- [ ] 提取DEMAPS[5]和DEMAPS[6]
- [ ] 提取ENMAPS[5]和ENMAPS[6]
- [ ] 创建完整的映射表常量
- [ ] 实现calculate_offset()
- [ ] 实现encode_byte/decode_byte
- [ ] 实现encode_stream/decode_stream
- [ ] 更新KingObj使用新算法
- [ ] 编写单元测试
- [ ] 与Java版本对比验证
- [ ] 集成测试

## 🎯 性能优化建议

1. **缓存offset**: offset基于时间，不需要每次都计算
2. **查找表优化**: 使用const数组和直接索引访问
3. **批量处理**: 一次处理整个数据块
4. **零拷贝**: 尽可能原地修改数据

## ⚠️ 注意事项

1. **字节序**: Java的byte是有符号的(-128到127)，Rust的u8是无符号的(0-255)
2. **索引越界**: 确保所有数组访问都在0-255范围内
3. **类型转换**: 注意XOR运算时的类型转换
4. **状态管理**: KingObj中的状态需要正确维护

## 📊 对比分析

| 特性 | Java实现 | Rust当前实现 | Rust目标实现 |
|------|----------|-------------|-------------|
| �射表数量 | 7x256 | 1x(简化) | 7x256 |
| 加密算法 | map[(input XOR prev) & 0xFF] | XOR | map[(input XOR prev) & 0xFF] |
| Offset计算 | 基于时间 | 简单递增 | 基于时间 |
| 状态管理 | 完整 | 简化 | 完整 |

## 🔬 字节码深度分析结果

### 重要发现

#### 1. KingObj的状态机制

**KingObj类包含以下字段**：
```java
private int firstseed;              // 初始种子（来自updateOffset()）
private byte[] decodelastendcipher;  // 解密最后密文缓冲（2字节）
private byte encodelastendcipher;    // 加密最后密文（单字节）
private int num;                     // 解密计数
private int encodeindex;             // 加密索引
private int decodeindex;             // 解密索引
```

#### 2. encode调用链

**KingObj.encode方法**：
```java
public byte[] encode(byte[] data, int length) {
    // 调用 King.encode(data, length, encodeindex, encodelastendcipher)
    King.encode(data, length, this.encodeindex, this.encodelastendcipher);

    // 更新状态
    this.encodelastendcipher = data[length - 1];  // 保存最后一个加密字节
    this.encodeindex += length;
    return data;
}
```

**关键点**：每次加密时使用上一次加密的最后一个字节作为部分seed！

#### 3. decode调用链

**KingObj.decode方法**：
```java
public byte[] decode(byte[] data, int length) {
    // 调用 King.decode(data, length, decodeindex, ...)
    King.decode(data, length, this.decodeindex, ...);

    // 更新decodelastendcipher缓冲
    this.decodeindex += length;
    this.num++;
    return data;
}
```

#### 4. King.encode/decode方法分析

**encode方法签名**：
```java
public static byte[] encode(byte[] data, int length, int index, byte seed)
```

**字节码分析**：
- 选择映射表：`enmaps[(index + seed) % 7][(index + seed) % 256]`
- 第一个字节：`encodebyte(map, data[0], seed)`
- 后续字节：`encodebyte(map, data[i], data[i-1])`

**decode方法签名**：
```java
public static byte[] decode(byte[] data, int length, int index, byte seed)
```

**字节码分析**：
- **从后向前解密**（i从length-1到1）
- 使用映射表：`demaps[(index + seed) % 7][(index + seed) % 256]`
- 循环体：`decodebyte(map, data[i], data[i-1])`（data[i-1]此时还是加密值）
- 最后处理：`decodebyte(map, data[0], seed)`

### ⚠️  核心问题

**即使使用真实映射表和正确的从后向前解密，仍然无法成功往返！**

测试结果：
```
原始数据: [72, 101, 108]
加密数据: [212, 64, 75]
解密数据: [72, 40, 126]  ❌ (期望[72, 101, 108])
```

### 可能的原因

1. **状态机复杂性**：KingObj的状态机制比我理解的更复杂
2. **映射表选择**：可能使用了不同的映射表选择逻辑
3. **索引累积**：encodeindex/decodeindex的累积方式可能有特殊含义
4. **encodelastendcipher作用**：上一次加密的最后字节可能影响下一次加密

### 📝 实现建议

鉴于King算法的复杂性，建议：

1. **短期**：继续使用简化的XOR加密（已验证能工作）
2. **中期**：通过动态调试Java程序来理解完整的数据流
3. **长期**：考虑与Java版本互操作，而不是完全复刻算法
