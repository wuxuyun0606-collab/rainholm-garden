// 确定性 PRNG（mulberry32），状态是单个 32 位整数，可序列化进存档。
// 学自 chorus 钓鱼：给定 seed + 调用序列完全可复现。
export class Rng {
    state;
    constructor(state) {
        this.state = state | 0;
    }
    /** 返回 [0,1) */
    next() {
        let a = (this.state = (this.state + 0x6d2b79f5) | 0);
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    /** 整数 [0, n) */
    int(n) {
        return Math.floor(this.next() * n);
    }
    /** 从数组随机取一个 */
    pick(arr) {
        return arr[this.int(arr.length)];
    }
    /** 按权重抽取索引 */
    weighted(weights) {
        const total = weights.reduce((s, w) => s + w, 0);
        let r = this.next() * total;
        for (let i = 0; i < weights.length; i++) {
            r -= weights[i];
            if (r < 0)
                return i;
        }
        return weights.length - 1;
    }
}
/** 生成一个初始 seed（仅在创建农场时用一次，之后只用 Rng 推进） */
export function freshSeed() {
    return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
}
//# sourceMappingURL=rng.js.map