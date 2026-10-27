import { Injectable } from '@nestjs/common';
import { Database } from '../db';
import { StockService } from '../stock';
import { ProductService } from '../products';
import type { Client } from './contracts';
import { IntegrationOperations } from './operations';
import { IntegrationQueries } from './queries';
// Fachada mantém a interface consumida pelo controller e pelos testes/scripts existentes.
@Injectable()
export class IntegrationService {
    private readonly operations: IntegrationOperations;
    private readonly queries: IntegrationQueries;
    constructor(db: Database, stock: StockService, products: ProductService) {
        this.operations = new IntegrationOperations(db, stock, products);
        this.queries = new IntegrationQueries(db, stock, products);
    }
    move(client: Client, key: unknown, body: unknown) { return this.operations.move(client, key, body); }
    create(client: Client, key: unknown, body: unknown) { return this.operations.create(client, key, body); }
    productOptions() { return this.queries.productOptions(); }
    matches(q: unknown) { return this.queries.matches(q); }
    search(q: unknown) { return this.queries.search(q); }
    balances(id: string) { return this.queries.balances(id); }
    locations(q: unknown, id?: string) { return this.queries.locations(q, id); }
    result(client: Client, key: string) { return this.queries.result(client, key); }
    history(client: Client, ticket: string, q: unknown) { return this.queries.history(client, ticket, q); }
}
