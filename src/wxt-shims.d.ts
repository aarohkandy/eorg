declare function defineContentScript(config: {
  matches: string[];
  runAt?: string;
  main: () => void;
}): unknown;

declare function defineBackground(setup: () => void): unknown;
