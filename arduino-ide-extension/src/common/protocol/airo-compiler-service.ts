export const AiroCompilerServicePath = '/services/airo-compiler-service';
export const AiroCompilerService = Symbol('AiroCompilerService');

export interface AiroCompilerService {
  /**
   * Transpile .airo source code to C++/Arduino (.ino) code.
   * @param airoCode The .airo source code to transpile.
   * @returns The generated C++/Arduino code.
   */
  transpileAiro(airoCode: string): Promise<string>;
}
