import { BackgroundAnalysisRunner } from './backgroundAnalysis';
import { run } from './nodeServer';
import { PyrightServer } from './server';

export function main() {
    run(
        (conn) => new PyrightServer(conn),
        () => {
            const runner = new BackgroundAnalysisRunner();
            runner.start();
        }
    );
}
