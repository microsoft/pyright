/*
 * Attempted priority based task scheduling.
 * Current FIFO task processing causes user-facing operations (like file editing) 
 * to wait behind low-priority background tasks.
 * Used a min-heap priority queue where lower numbers = higher priority
 * 
 * The user should get instant feedback on files they're actively editing while
 * background analysis continues at lower priority.
 */

import { MessagePort } from 'worker_threads';

export const enum TaskPriority {
    UserEditing = 1,
    OpenFile = 2,
    ProjectFile = 3,
    ThirdPartyFile = 4
}

export interface PriorityTask {
    priority: TaskPriority;
    requestType: string;
    data: string | null;
    port?: MessagePort | undefined;
    sharedUsageBuffer?: SharedArrayBuffer;
    timestamp: number;
}

export class PriorityTaskScheduler {
    private _heap: PriorityTask[] = [];
    private _taskCounter = 0;

    enqueue(task: Omit<PriorityTask, 'timestamp'>): void {
        const priorityTask: PriorityTask = {
            ...task,
            timestamp: this._taskCounter++
        };
        
        this._heap.push(priorityTask);
        this._heapifyUp(this._heap.length - 1);
    }

    dequeue(): PriorityTask | undefined {
        if (this._heap.length === 0) return undefined;
        if (this._heap.length === 1) return this._heap.pop();

        const result = this._heap[0];
        this._heap[0] = this._heap.pop()!;
        this._heapifyDown(0);
        return result;
    }

    peek(): PriorityTask | undefined {
        return this._heap.length > 0 ? this._heap[0] : undefined;
    }

    size(): number {
        return this._heap.length;
    }

    isEmpty(): boolean {
        return this._heap.length === 0;
    }

    clear(): void {
        this._heap = [];
        this._taskCounter = 0;
    }

    private _heapifyUp(index: number): void {
        while (index > 0) {
            const parentIndex = Math.floor((index - 1) / 2);
            if (!this._shouldSwap(index, parentIndex)) break;
            
            this._swap(index, parentIndex);
            index = parentIndex;
        }
    }

    private _heapifyDown(index: number): void {
        while (true) {
            let minIndex = index;
            const leftChild = 2 * index + 1;
            const rightChild = 2 * index + 2;

            if (leftChild < this._heap.length && this._shouldSwap(leftChild, minIndex)) {
                minIndex = leftChild;
            }

            if (rightChild < this._heap.length && this._shouldSwap(rightChild, minIndex)) {
                minIndex = rightChild;
            }

            if (minIndex === index) break;

            this._swap(index, minIndex);
            index = minIndex;
        }
    }

    private _shouldSwap(childIndex: number, parentIndex: number): boolean {
        const child = this._heap[childIndex];
        const parent = this._heap[parentIndex];
        
        if (child.priority !== parent.priority) {
            return child.priority < parent.priority;
        }
        
        return child.timestamp < parent.timestamp;
    }

    private _swap(i: number, j: number): void {
        [this._heap[i], this._heap[j]] = [this._heap[j], this._heap[i]];
    }
}

export function determineTaskPriority(requestType: string, fileUri?: string): TaskPriority {
    if (requestType === 'analyzeFileAndGetDiagnostics' || 
        requestType === 'getDiagnosticsForRange' ||
        requestType === 'setFileOpened') {
        return TaskPriority.UserEditing;
    }

    if (requestType === 'analyze' || requestType === 'resumeAnalysis') {
        if (fileUri) {
            if (fileUri.includes('node_modules') || 
                fileUri.includes('site-packages') ||
                fileUri.includes('.venv') ||
                fileUri.includes('typeshed')) {
                return TaskPriority.ThirdPartyFile;
            }
            
            return TaskPriority.ProjectFile;
        }
        return TaskPriority.ProjectFile;
    }

    return TaskPriority.ProjectFile;
}
