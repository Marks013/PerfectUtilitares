solverforge::planning_model! {
    root = "src/domain";
    mod employee;
    mod plan;
    pub use employee::Employee;
    pub use plan::Plan;
}
