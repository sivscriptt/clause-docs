export type VersionNo = { major: number; minor: number };
export type Target = "minor" | "major";

export const nextVersion = (current: VersionNo | null, target: Target): VersionNo =>
  current === null
    ? { major: 1, minor: 0 }
    : target === "major"
      ? { major: current.major + 1, minor: 0 }
      : { major: current.major, minor: current.minor + 1 };

export const formatVersion = (v: VersionNo) => `${v.major}.${v.minor}`;
