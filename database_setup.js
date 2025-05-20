const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Create/connect to the database
const db = new sqlite3.Database(path.join(__dirname, 'restaurant.db'), (err) => {
    if (err) {
        console.error('Error connecting to database:', err);
        process.exit(1);
    }
    console.log('Connected to the restaurant database.');
});

// Enable foreign keys
db.run('PRAGMA foreign_keys = ON;');

// Create tables
const createTables = () => {
    const tables = [
        `CREATE TABLE IF NOT EXISTS CUSTOMERS (
            CustomerID INTEGER PRIMARY KEY AUTOINCREMENT,
            Name TEXT NOT NULL,
            Phone TEXT UNIQUE,
            Email TEXT UNIQUE
        )`,
        `CREATE TABLE IF NOT EXISTS RESERVATIONS (
            ReservationID INTEGER PRIMARY KEY AUTOINCREMENT,
            CustomerID INTEGER NOT NULL,
            TableNumber INTEGER NOT NULL,
            DateTime TEXT NOT NULL,
            NumberOfGuests INTEGER NOT NULL CHECK(NumberOfGuests > 0),
            Status TEXT NOT NULL DEFAULT 'Confirmed' CHECK(Status IN ('Confirmed', 'Seated', 'Cancelled', 'Completed', 'No-Show')),
            FOREIGN KEY(CustomerID) REFERENCES CUSTOMERS(CustomerID)
        )`,
        `CREATE TABLE IF NOT EXISTS STAFF (
            StaffID INTEGER PRIMARY KEY AUTOINCREMENT,
            Name TEXT NOT NULL,
            Username TEXT NOT NULL UNIQUE,
            Role TEXT NOT NULL CHECK(Role IN ('Manager', 'Waiter', 'Chef')),
            PasswordHash TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS ORDERS (
            OrderID INTEGER PRIMARY KEY AUTOINCREMENT,
            ReservationID INTEGER,
            StaffID INTEGER NOT NULL,
            TableNumber INTEGER NOT NULL,
            OrderDateTime TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            Status TEXT NOT NULL DEFAULT 'Placed' CHECK(Status IN ('Placed', 'Preparing', 'Ready for Service', 'Served', 'Paid', 'Cancelled')),
            TotalPrice REAL NOT NULL DEFAULT 0.00,
            FOREIGN KEY(ReservationID) REFERENCES RESERVATIONS(ReservationID),
            FOREIGN KEY(StaffID) REFERENCES STAFF(StaffID)
        )`,
        `CREATE TABLE IF NOT EXISTS MENU_ITEMS (
            MenuItemID INTEGER PRIMARY KEY AUTOINCREMENT,
            Name TEXT NOT NULL UNIQUE,
            Description TEXT,
            Price REAL NOT NULL CHECK(Price > 0),
            Category TEXT NOT NULL CHECK(Category IN ('Appetizer', 'Main Course', 'Dessert', 'Beverage'))
        )`,
        `CREATE TABLE IF NOT EXISTS ORDER_ITEMS (
            OrderItemID INTEGER PRIMARY KEY AUTOINCREMENT,
            OrderID INTEGER NOT NULL,
            MenuItemID INTEGER NOT NULL,
            Quantity INTEGER NOT NULL DEFAULT 1 CHECK(Quantity > 0),
            SpecialRequests TEXT,
            Subtotal REAL NOT NULL,
            FOREIGN KEY(OrderID) REFERENCES ORDERS(OrderID),
            FOREIGN KEY(MenuItemID) REFERENCES MENU_ITEMS(MenuItemID)
        )`
    ];

    return Promise.all(tables.map(table => {
        return new Promise((resolve, reject) => {
            db.run(table, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }));
};

// Insert sample data
const insertSampleData = () => {
    // WARNING: These are plain text passwords for development only!
    // In production, use bcrypt.js for password hashing
    const staffData = [
        ['John Manager', 'manager', 'Manager', 'password123'],
        ['Alice Waiter', 'waiter1', 'Waiter', 'password123']
    ];

    const menuItems = [
        ['Caesar Salad', 'Fresh romaine lettuce with Caesar dressing', 8.99, 'Appetizer'],
        ['Garlic Bread', 'Toasted bread with garlic butter', 4.99, 'Appetizer'],
        ['Grilled Salmon', 'Fresh salmon with lemon butter sauce', 24.99, 'Main Course'],
        ['Beef Steak', '8oz ribeye steak with vegetables', 29.99, 'Main Course'],
        ['Chocolate Cake', 'Rich chocolate cake with ganache', 7.99, 'Dessert'],
        ['Tiramisu', 'Classic Italian dessert', 8.99, 'Dessert'],
        ['House Wine', 'Red wine, glass', 6.99, 'Beverage'],
        ['Sparkling Water', 'Bottled sparkling water', 3.99, 'Beverage']
    ];

    return Promise.all([
        // Insert staff
        ...staffData.map(staff => {
            return new Promise((resolve, reject) => {
                db.run(
                    'INSERT OR IGNORE INTO STAFF (Name, Username, Role, PasswordHash) VALUES (?, ?, ?, ?)',
                    staff,
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
        }),
        // Insert menu items
        ...menuItems.map(item => {
            return new Promise((resolve, reject) => {
                db.run(
                    'INSERT OR IGNORE INTO MENU_ITEMS (Name, Description, Price, Category) VALUES (?, ?, ?, ?)',
                    item,
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
        })
    ]);
};

// Main setup function
const setupDatabase = async () => {
    try {
        await createTables();
        console.log('Tables created successfully.');
        
        await insertSampleData();
        console.log('Sample data inserted successfully.');
        
        console.log('\nDatabase setup completed successfully!');
        console.log('\nWARNING: The sample staff accounts use plain text passwords.');
        console.log('In production, implement proper password hashing using bcrypt.js!');
        
        db.close();
    } catch (err) {
        console.error('Error during database setup:', err);
        db.close();
        process.exit(1);
    }
};

// Run the setup
setupDatabase(); 