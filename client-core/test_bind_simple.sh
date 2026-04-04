#!/bin/bash

echo "=== 测试 TcpListener::bind() 行为 ==="
echo ""

# 使用Python快速测试
python3 << 'PYTHON'
import socket
import time

print("1. 第一次绑定端口 1081")
try:
    sock1 = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock1.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock1.bind(('127.0.0.1', 1081))
    sock1.listen(1)
    print("   ✓ 第一次绑定成功")
    
    time.sleep(0.1)
    
    print("")
    print("2. 第二次绑定端口 1081 (应该立即失败)")
    start = time.time()
    try:
        sock2 = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock2.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock2.bind(('127.0.0.1', 1081))
        print("   ✗ 第二次绑定竟然成功了（不应该）")
    except Exception as e:
        elapsed = (time.time() - start) * 1000
        print(f"   ✓ 第二次绑定失败")
        print(f"   错误: {e}")
        print(f"   耗时: {elapsed:.2f}ms")
        
        if elapsed < 100:
            print("   ✓ 错误是立即返回的（< 100ms）")
        else:
            print(f"   ✗ 错误返回太慢了（> 100ms）")
    
    time.sleep(2)
    sock1.close()
    
except Exception as e:
    print(f"   ✗ 第一次绑定失败: {e}")
PYTHON

echo ""
echo "测试完成"
