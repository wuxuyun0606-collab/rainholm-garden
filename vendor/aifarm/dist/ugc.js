export const ugcById = new Map();
export function registerUgc(crop) {
    ugcById.set(crop.id, crop);
}
export function allUgc() {
    return [...ugcById.values()];
}
/** 当前自创作物总数（全服上限判定用）*/
export function ugcCount() {
    return ugcById.size;
}
/** 序列化 / 反序列化（存档用）*/
export function dumpUgc() {
    return allUgc();
}
export function loadUgc(arr) {
    ugcById.clear();
    for (const c of arr ?? [])
        ugcById.set(c.id, c);
}
//# sourceMappingURL=ugc.js.map