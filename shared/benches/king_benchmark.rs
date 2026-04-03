// King加密算法性能基准测试（5倍数据集）

use criterion::{black_box, criterion_group, criterion_main, Criterion};
use shared::KingObj;

fn bench_scaled_up(c: &mut Criterion) {
    let mut group = c.benchmark_group("king_scaled");
    group.sample_size(10);
    group.warm_up_time(std::time::Duration::from_millis(500));
    group.measurement_time(std::time::Duration::from_secs(2));

    // 测试40KB（8KB的5倍）
    group.bench_function("40KB", |b| {
        let mut king = KingObj::new();
        let data: Vec<u8> = (0..40960).map(|i| i as u8).collect();

        b.iter(|| {
            let mut test_data = data.clone();
            king.encode(&mut test_data, 40960).unwrap();
            black_box(&test_data);
        });
    });
    group.finish();
}

criterion_group!(benches, bench_scaled_up);
criterion_main!(benches);
