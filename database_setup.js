const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

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
            Status TEXT NOT NULL DEFAULT 'Placed' CHECK(Status IN ('Placed', 'Ready for Kitchen', 'Preparing', 'Ready for Service', 'Served', 'Paid', 'Cancelled')),
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
        )`,
        `CREATE TABLE IF NOT EXISTS INVENTORY_ITEMS (
            ItemID INTEGER PRIMARY KEY AUTOINCREMENT,
            ItemName TEXT NOT NULL UNIQUE,
            Description TEXT,
            QuantityOnHand INTEGER NOT NULL DEFAULT 0,
            Unit TEXT,
            ReorderLevel INTEGER NOT NULL DEFAULT 0,
            SupplierID INTEGER,
            FOREIGN KEY(SupplierID) REFERENCES SUPPLIERS(SupplierID)
        )`,
        `CREATE TABLE IF NOT EXISTS SUPPLIERS (
            SupplierID INTEGER PRIMARY KEY AUTOINCREMENT,
            Name TEXT NOT NULL,
            ContactPerson TEXT,
            Phone TEXT,
            Email TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS SHIFTS (
            ShiftID INTEGER PRIMARY KEY AUTOINCREMENT,
            StartDateTime TEXT NOT NULL,
            EndDateTime TEXT NOT NULL,
            RoleRequired TEXT CHECK(RoleRequired IN ('Manager', 'Waiter', 'Chef', NULL))
        )`,
        `CREATE TABLE IF NOT EXISTS STAFF_SHIFTS (
            StaffShiftID INTEGER PRIMARY KEY AUTOINCREMENT,
            StaffID INTEGER NOT NULL,
            ShiftID INTEGER NOT NULL,
            ManagerApprovalStatus TEXT NOT NULL DEFAULT 'Pending' CHECK(ManagerApprovalStatus IN ('Pending', 'Approved', 'Denied')),
            FOREIGN KEY(StaffID) REFERENCES STAFF(StaffID),
            FOREIGN KEY(ShiftID) REFERENCES SHIFTS(ShiftID)
        )`,
        `CREATE TABLE IF NOT EXISTS MENU_ITEM_INGREDIENTS (
            MenuItemIngredientID INTEGER PRIMARY KEY AUTOINCREMENT,
            MenuItemID INTEGER NOT NULL,
            InventoryItemID INTEGER NOT NULL,
            QuantityRequired REAL NOT NULL,
            FOREIGN KEY(MenuItemID) REFERENCES MENU_ITEMS(MenuItemID),
            FOREIGN KEY(InventoryItemID) REFERENCES INVENTORY_ITEMS(ItemID)
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
    // Hash passwords for sample staff accounts
    const staffData = [
        ['John Manager', 'manager', 'Manager', bcrypt.hashSync('password123', 10)],
        ['Alice Waiter', 'waiter1', 'Waiter', bcrypt.hashSync('password123', 10)],
        ['Bob Chef', 'chef1', 'Chef', bcrypt.hashSync('password123', 10)]
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

    // Sample inventory items
    const inventoryItems = [
        ['Romaine Lettuce', 'Fresh romaine lettuce heads', 20, 'piece', 5],
        ['Olive Oil', 'Extra virgin olive oil', 10, 'bottle', 2],
        ['Salmon Fillet', 'Fresh salmon fillets', 15, 'piece', 5],
        ['Beef Steak', 'Premium ribeye steaks', 25, 'piece', 8],
        ['Chocolate', 'Dark chocolate for desserts', 5, 'kg', 1]
    ];

    // Sample suppliers
    const suppliers = [
        ['Fresh Produce Co.', 'John Smith', '555-0101', 'john@freshproduce.com'],
        ['Ocean Seafood', 'Sarah Lee', '555-0102', 'sarah@oceanseafood.com'],
        ['Premium Meats', 'Mike Johnson', '555-0103', 'mike@premiummeats.com']
    ];

    // Sample menu item ingredients
    const menuItemIngredients = [
        // Caesar Salad ingredients
        [1, 1, 1], // 1 Romaine Lettuce for Caesar Salad
        [1, 2, 0.1], // 0.1 bottle of Olive Oil for Caesar Salad
        
        // Grilled Salmon ingredients
        [3, 3, 1], // 1 Salmon Fillet for Grilled Salmon
        [3, 2, 0.05], // 0.05 bottle of Olive Oil for Grilled Salmon
        
        // Beef Steak ingredients
        [4, 4, 1], // 1 Beef Steak for Beef Steak menu item
        
        // Chocolate Cake ingredients
        [5, 5, 0.2] // 0.2 kg of Chocolate for Chocolate Cake
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
        }),
        // Insert suppliers
        ...suppliers.map(supplier => {
            return new Promise((resolve, reject) => {
                db.run(
                    'INSERT OR IGNORE INTO SUPPLIERS (Name, ContactPerson, Phone, Email) VALUES (?, ?, ?, ?)',
                    supplier,
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
        }),
        // Insert inventory items
        ...inventoryItems.map(item => {
            return new Promise((resolve, reject) => {
                db.run(
                    'INSERT OR IGNORE INTO INVENTORY_ITEMS (ItemName, Description, QuantityOnHand, Unit, ReorderLevel) VALUES (?, ?, ?, ?, ?)',
                    item,
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
        }),
        // Insert menu item ingredients
        ...menuItemIngredients.map(ingredient => {
            return new Promise((resolve, reject) => {
                db.run(
                    'INSERT OR IGNORE INTO MENU_ITEM_INGREDIENTS (MenuItemID, InventoryItemID, QuantityRequired) VALUES (?, ?, ?)',
                    ingredient,
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
        console.log('\nSample staff accounts created with hashed passwords:');
        console.log('- Username: manager, Password: password123');
        console.log('- Username: waiter1, Password: password123');
        console.log('- Username: chef1, Password: password123');
        console.log('\nNote: These are sample accounts for development only.');
        console.log('In production, ensure all staff use strong, unique passwords!');
        
        db.close();
    } catch (err) {
        console.error('Error during database setup:', err);
        db.close();
        process.exit(1);
    }
};

// Run the setup
setupDatabase(); 